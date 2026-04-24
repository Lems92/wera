import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import Peer from 'peerjs';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { API_URL, SOCKET_URL } from '../config';
import { useMediaQuery } from '../hooks/useMediaQuery';
import AdSlot from '../components/AdSlot';

// const SOCKET_URL = 'http://localhost:3001'; // Removed

export default function Chat() {
    const { user, token } = useAuth();
    const navigate = useNavigate();
    const isNarrow = useMediaQuery('(max-width: 900px)');
    const isMobile = useMediaQuery('(max-width: 600px)');

    const [status, setStatus] = useState('idle');
    // idle | waiting | connected | ended
    const [messages, setMessages] = useState([]);
    const [inputMsg, setInputMsg] = useState('');
    const [partnerName, setPartnerName] = useState('');
    const [isMuted, setIsMuted] = useState(false);
    const [isCamOff, setIsCamOff] = useState(false);
    const [waitingTooLong, setWaitingTooLong] = useState(false);
    const [onlineCount, setOnlineCount] = useState(77188); // Mock value
    const [country, setCountry] = useState('Madagascar');
    const [gender, setGender] = useState('Both');

    const socketRef = useRef(null);
    const peerRef = useRef(null);
    const localStream = useRef(null);
    const localVideo = useRef(null);
    const remoteVideo = useRef(null);
    const currentCall = useRef(null);
    const messagesEnd = useRef(null);
    const peerIdRef = useRef(null);
    const pendingFindRef = useRef(false);
    const userRef = useRef(null);
    const waitingTimerRef = useRef(null);
    const statusRef = useRef('idle');

    useEffect(() => {
        userRef.current = user;
    }, [user]);

    useEffect(() => {
        statusRef.current = status;
    }, [status]);

    // Redirige si pas connecté
    useEffect(() => {
        if (!user) navigate('/login');
    }, [user]);

    // Initialise socket + caméra au montage
    useEffect(() => {
        initSocket();
        startCamera();
        initPeer();
        return () => cleanup();
    }, []);

    // Auto-scroll messages
    useEffect(() => {
        messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    // Timer pour la notification après 2 minutes d'attente
    useEffect(() => {
        if (status === 'waiting') {
            waitingTimerRef.current = setTimeout(() => {
                setWaitingTooLong(true);
            }, 120000); // 2 minutes
        } else {
            if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
            setWaitingTooLong(false);
        }
        return () => {
            if (waitingTimerRef.current) clearTimeout(waitingTimerRef.current);
        };
    }, [status]);

    const initSocket = () => {
        socketRef.current = io(SOCKET_URL, {
            // Polling is the most reliable transport on some networks/proxies.
            // We disable upgrade to avoid flaky websocket handshakes/timeouts.
            transports: ['polling'],
            upgrade: false,
            withCredentials: true,
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 500,
            timeout: 20000
        });

        socketRef.current.on('connect', () => {
            // If user was searching or clicked "Démarrer" while socket was connecting.
            if (statusRef.current === 'waiting' || pendingFindRef.current) {
                maybeStartSearch(true);
            }
        });

        socketRef.current.on('connect_error', (err) => {
            console.error('Socket connect_error:', err?.message || err);
        });

        socketRef.current.on('waiting', () => setStatus('waiting'));

        socketRef.current.on('partner_found', ({ partnerPeerId, partnerUsername, initiator }) => {
            setPartnerName(partnerUsername);
            setStatus('connected');
            setMessages([]);
            connectVideo(partnerPeerId, initiator);
        });

        socketRef.current.on('receive_message', (msg) => {
            setMessages(prev => [...prev, { ...msg, self: false }]);
        });

        socketRef.current.on('partner_left', () => {
            setPartnerName('');
            if (remoteVideo.current) remoteVideo.current.srcObject = null;
            currentCall.current?.close();
            findPartner();
        });

        socketRef.current.on('skipped', () => {
            setStatus('idle');
        });
    };

    const maybeStartSearch = (force = false) => {
        const socket = socketRef.current;
        const u = userRef.current;
        if (!force && !pendingFindRef.current) return;
        if (!u?.username) return;
        if (!localStream.current) return;
        if (!peerIdRef.current) return;
        if (!socket?.connected) return;

        pendingFindRef.current = false;
        socket.emit('find_partner', {
            peerId: peerIdRef.current,
            username: u.username
        });
        setStatus('waiting');
    };

    const initPeer = () => {
        // Create a single Peer instance for the whole session.
        // Multiple Peer() instances cause mismatched peerIds and failed calls.
        const peerServerUrl = new URL(SOCKET_URL);

        const peer = new Peer(undefined, {
            host: peerServerUrl.hostname,
            port: peerServerUrl.port ? Number(peerServerUrl.port) : (peerServerUrl.protocol === 'https:' ? 443 : 80),
            secure: peerServerUrl.protocol === 'https:',
            path: '/peerjs',
            // Public STUN servers help with NAT traversal. TURN may still be needed for strict networks.
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:global.stun.twilio.com:3478' }
                ]
            }
        });

        peerRef.current = peer;

        peer.on('open', (id) => {
            peerIdRef.current = id;
            maybeStartSearch();
        });

        peer.on('call', (call) => {
            // Always be ready to answer incoming calls.
            if (!localStream.current) return;
            currentCall.current = call;
            call.answer(localStream.current);
            call.on('stream', (remoteStream) => {
                if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream;
            });
        });

        peer.on('error', (err) => {
            console.error('Peer error:', err);
        });

        peer.on('disconnected', () => {
            // Best-effort reconnect without changing peerIdRef unless a new open fires.
            try { peer.reconnect(); } catch { /* ignore */ }
        });
    };

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localStream.current = stream;
            if (localVideo.current) localVideo.current.srcObject = stream;
            // If "Démarrer" was clicked before camera was ready, start search now.
            maybeStartSearch();
        } catch (err) {
            alert('Impossible d\'accéder à la caméra/micro. Autorise l\'accès dans ton navigateur.');
        }
    };

    const connectVideo = (partnerPeerId, initiator) => {
        const peer = peerRef.current;
        if (!peer || !peerIdRef.current) return;
        if (!localStream.current) return;

        if (initiator) {
            // Close any previous call before starting a new one (e.g. after "Suivant").
            currentCall.current?.close();
            const call = peer.call(partnerPeerId, localStream.current);
            currentCall.current = call;
            call.on('stream', (remoteStream) => {
                if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream;
            });
            call.on('error', (err) => console.error('Call error:', err));
        }
    };

    const findPartner = () => {
        if (!localStream.current) return alert('Caméra non disponible');
        pendingFindRef.current = true;
        maybeStartSearch();
        // If peer/socket aren't ready yet, UI still shows "Recherche..." and auto-starts when ready.
        setStatus('waiting');
    };

    const skip = () => {
        currentCall.current?.close();
        if (remoteVideo.current) remoteVideo.current.srcObject = null;
        socketRef.current.emit('skip');
        findPartner();
    };

    const stop = () => {
        currentCall.current?.close();
        if (status === 'waiting') {
            socketRef.current.emit('cancel_search');
        } else {
            socketRef.current.emit('skip');
        }
        if (remoteVideo.current) remoteVideo.current.srcObject = null;
        setStatus('idle');
        setMessages([]);
        setPartnerName('');
    };

    const sendMessage = (e) => {
        e.preventDefault();
        if (!inputMsg.trim() || status !== 'connected') return;
        socketRef.current.emit('send_message', inputMsg);
        setMessages(prev => [...prev, {
            text: inputMsg,
            from: user.username,
            time: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
            self: true
        }]);
        setInputMsg('');
    };

    const toggleMute = () => {
        if (localStream.current) {
            localStream.current.getAudioTracks().forEach(t => t.enabled = isMuted);
            setIsMuted(!isMuted);
        }
    };

    const toggleCam = () => {
        if (localStream.current) {
            localStream.current.getVideoTracks().forEach(t => t.enabled = isCamOff);
            setIsCamOff(!isCamOff);
        }
    };

    const reportUser = async () => {
        if (!window.confirm('Signaler cet utilisateur ?')) return;
        try {
            await axios.post(`${API_URL}/reports`,
                { reported_id: partnerName, reason: 'Comportement inapproprié' },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            alert('Signalement envoyé. Merci !');
            skip();
        } catch { alert('Erreur lors du signalement'); }
    };

    const cleanup = () => {
        localStream.current?.getTracks().forEach(t => t.stop());
        socketRef.current?.disconnect();
        peerRef.current?.destroy();
    };

    // ── Styles ──────────────────────────────────────────────
    const s = {
        page: {
            display: 'flex',
            flexDirection: 'column',
            height: '100dvh',
            background: '#000',
            color: '#fff',
            overflow: 'hidden',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
        },
        desktopLayout: {
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gridTemplateRows: '1fr auto',
            height: '100%',
            background: '#111',
            padding: '20px',
            gap: '20px'
        },
        mobileHeader: {
            padding: '10px 15px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
            background: '#000',
            borderBottom: '1px solid #333'
        },
        statsRow: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            fontSize: '14px',
            fontWeight: '500'
        },
        onlineDot: {
            width: '10px',
            height: '10px',
            borderRadius: '50%',
            background: '#00ff00'
        },
        filtersRow: {
            display: 'flex',
            gap: '10px'
        },
        filterBtn: {
            flex: 1,
            padding: '10px',
            background: 'transparent',
            border: '1px solid #555',
            borderRadius: '8px',
            color: '#fff',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            fontWeight: 'bold',
            textTransform: 'uppercase'
        },
        mainContent: {
            flex: 1,
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
        },
        videoContainer: {
            flex: 1,
            position: 'relative',
            background: '#000',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        },
        remoteVideo: {
            width: '100%',
            height: '100%',
            objectFit: 'cover'
        },
        localVideoOverlay: {
            position: 'absolute',
            bottom: '20px',
            right: '20px',
            width: '120px',
            height: '160px',
            borderRadius: '12px',
            border: '2px solid #555',
            background: '#222',
            objectFit: 'cover',
            zIndex: 10
        },
        bottomNav: {
            height: '70px',
            background: '#111',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-around',
            borderTop: '1px solid #222',
            paddingBottom: 'env(safe-area-inset-bottom)'
        },
        navItem: (active) => ({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            color: active ? '#00ff00' : '#888',
            fontSize: '24px',
            background: 'none',
            border: 'none',
            cursor: 'pointer'
        }),
        pcVideoFrame: {
            position: 'relative',
            background: '#1a1a1a',
            borderRadius: '12px',
            overflow: 'hidden',
            aspectRatio: '4/3',
            border: '2px solid #333'
        },
        pcControls: {
            gridColumn: '1 / span 2',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '20px',
            padding: '10px'
        },
        pcBtn: (color) => ({
            padding: '12px 30px',
            borderRadius: '8px',
            border: 'none',
            fontWeight: 'bold',
            fontSize: '16px',
            cursor: 'pointer',
            background: color,
            color: '#fff'
        }),
        chatOverlay: {
            position: 'absolute',
            bottom: '20px',
            left: '20px',
            right: '20px',
            maxHeight: '30%',
            overflowY: 'auto',
            background: 'rgba(0,0,0,0.5)',
            borderRadius: '10px',
            padding: '10px',
            display: 'flex',
            flexDirection: 'column',
            gap: '5px',
            pointerEvents: 'none'
        },
        chatInputMobile: {
            position: 'absolute',
            bottom: '80px',
            left: '15px',
            right: '15px',
            display: 'flex',
            gap: '10px',
            zIndex: 20
        },
        input: {
            flex: 1,
            padding: '12px 15px',
            borderRadius: '25px',
            border: '1px solid #444',
            background: 'rgba(0,0,0,0.7)',
            color: '#fff',
            outline: 'none'
        },
        overlay: {
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.8)',
            zIndex: 100,
            textAlign: 'center',
            padding: '20px'
        }
    };

    if (!isMobile) {
        // ── PC Layout (Ome.tv style) ──
        return (
            <div style={s.page}>
                <div style={s.desktopLayout}>
                    {/* Vidéo Partenaire */}
                    <div style={s.pcVideoFrame}>
                        <video ref={remoteVideo} autoPlay playsInline style={s.remoteVideo} />
                        {status === 'waiting' && (
                            <div style={s.overlay}>
                                <div style={{ fontSize: '40px', animation: 'spin 1s linear infinite' }}>⏳</div>
                                <h2>Recherche...</h2>
                                <p>{waitingTooLong ? "Un peu de patience... 🇲🇬" : "En attente d'un partenaire"}</p>
                            </div>
                        )}
                        {status === 'idle' && (
                            <div style={s.overlay}>
                                <h2>Prêt ?</h2>
                                <button style={s.pcBtn('#00c853')} onClick={findPartner}>DÉMARRER</button>
                            </div>
                        )}
                        {/* Chat Overlay on Partner Video */}
                        <div style={s.chatOverlay}>
                            {messages.slice(-5).map((msg, i) => (
                                <div key={i} style={{ color: msg.self ? '#FFE000' : '#fff', fontSize: '14px', pointerEvents: 'none' }}>
                                    <b>{msg.self ? 'Moi' : msg.from}:</b> {msg.text}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Vidéo Locale */}
                    <div style={s.pcVideoFrame}>
                        <video ref={localVideo} autoPlay playsInline muted style={s.remoteVideo} />
                    </div>

                    {/* Contrôles Desktop */}
                    <div style={s.pcControls}>
                        <button style={s.pcBtn('#ff5252')} onClick={stop}>STOP</button>
                        <button style={s.pcBtn('#2979ff')} onClick={skip}>SUIVANT</button>
                        <form onSubmit={sendMessage} style={{ flex: 1, display: 'flex', gap: '10px' }}>
                            <input 
                                style={s.input} 
                                value={inputMsg} 
                                onChange={e => setInputMsg(e.target.value)} 
                                placeholder="Écrire un message..."
                                disabled={status !== 'connected'}
                            />
                            <button style={s.pcBtn('#FFE000')} type="submit" disabled={status !== 'connected'}>ENVOYER</button>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    // ── Mobile Layout (OmeTV style) ──
    return (
        <div style={s.page}>
            {/* Header Mobile */}
            <div style={s.mobileHeader}>
                <div style={s.statsRow}>
                    <div style={s.onlineDot} />
                    <span>{onlineCount.toLocaleString()} Users online</span>
                    <span style={{ marginLeft: 'auto', fontSize: '20px' }}>⚙️</span>
                </div>
                <div style={s.filtersRow}>
                    <button style={s.filterBtn}>
                        <span>COUNTRY:</span>
                        <span style={{ fontSize: '18px' }}>🇲🇬</span>
                    </button>
                    <button style={s.filterBtn}>
                        <span>I AM:</span>
                        <span style={{ fontSize: '18px' }}>👤</span>
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div style={s.mainContent}>
                <div style={s.videoContainer}>
                    <video ref={remoteVideo} autoPlay playsInline style={s.remoteVideo} />
                    
                    {/* Local Video Overlay */}
                    <video ref={localVideo} autoPlay playsInline muted style={s.localVideoOverlay} />

                    {/* State Overlays */}
                    {status === 'idle' && (
                        <div style={s.overlay}>
                            <h2 style={{ fontSize: '24px', marginBottom: '20px' }}>Prêt à discuter ?</h2>
                            <button 
                                style={{ ...s.pcBtn('#00c853'), borderRadius: '30px', padding: '15px 50px' }} 
                                onClick={findPartner}
                            >
                                DÉMARRER
                            </button>
                        </div>
                    )}

                    {status === 'waiting' && (
                        <div style={s.overlay}>
                            <div style={{ fontSize: '50px', animation: 'spin 1s linear infinite' }}>⏳</div>
                            <h2>Recherche en cours...</h2>
                            <p style={{ opacity: 0.7 }}>
                                {waitingTooLong ? "Presque là... 🇲🇬" : "On te cherche un partenaire"}
                            </p>
                        </div>
                    )}

                    {/* Rules/Overlay Text */}
                    <div style={{ 
                        position: 'absolute', bottom: '10px', left: '10px', right: '10px',
                        fontSize: '10px', color: 'rgba(255,255,255,0.6)', textAlign: 'center'
                    }}>
                        By using this videochat you agree with our rules. Rules violators will be banned.
                    </div>

                    {/* Quick controls on video for mobile */}
                    {status === 'connected' && (
                        <div style={{ position: 'absolute', bottom: '100px', right: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <button style={s.pcBtn('#2979ff')} onClick={skip}>⏭</button>
                            <button style={s.pcBtn('#ff5252')} onClick={stop}>✖</button>
                        </div>
                    )}
                </div>

                {/* Chat Input (Floating on mobile) */}
                {status === 'connected' && (
                    <form onSubmit={sendMessage} style={s.chatInputMobile}>
                        <input 
                            style={s.input} 
                            value={inputMsg} 
                            onChange={e => setInputMsg(e.target.value)} 
                            placeholder="Message..."
                        />
                        <button style={{ ...s.navItem(true), fontSize: '24px' }} type="submit">➤</button>
                    </form>
                )}
            </div>

            {/* Bottom Nav */}
            <div style={s.bottomNav}>
                <button style={s.navItem(false)}>👤</button>
                <button style={s.navItem(false)}>🔍</button>
                <button style={s.navItem(true)}>📺</button>
                <button style={s.navItem(false)}>✉️</button>
                <button style={s.navItem(false)}>🖼️</button>
            </div>
        </div>
    );
}