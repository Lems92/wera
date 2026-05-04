import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import Peer from 'peerjs';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { API_URL, SOCKET_URL } from '../config';
import AdSlot from '../components/AdSlot';
import './Chat.css';

// const SOCKET_URL = 'http://localhost:3001'; // Removed

export default function Chat() {
    const { user, token } = useAuth();
    const navigate = useNavigate();

    const [status, setStatus] = useState('idle');
    // idle | waiting | connected | ended
    const [messages, setMessages] = useState([]);
    const [inputMsg, setInputMsg] = useState('');
    const [partnerName, setPartnerName] = useState('');
    const [isMuted, setIsMuted] = useState(false);
    const [isCamOff, setIsCamOff] = useState(false);
    const [waitingTooLong, setWaitingTooLong] = useState(false);

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
            // Start with polling for better reliability, then upgrade to websocket.
            transports: ['polling', 'websocket'],
            withCredentials: true,
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 500,
            timeout: 30000
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
        } catch {
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

    const statusLine = () => {
        if (status === 'waiting') {
            return waitingTooLong
                ? "Il n'y a personne pour le moment, recherche en cours…"
                : "Recherche d'un partenaire…";
        }
        if (status === 'connected') return `Connecté avec ${partnerName}`;
        if (status === 'ended') return 'La conversation est terminée';
        return 'Démarrez une conversation depuis l’écran vidéo ci-dessus.';
    };

    const statusSub = () => {
        if (status === 'connected') return 'En ligne';
        if (status === 'waiting') return 'Patience…';
        if (status === 'ended') return 'Tu peux lancer une nouvelle recherche';
        return 'Pas connecté';
    };

    return (
        <div className="chat-page">
            <div className="video-grid-container">
                {status === 'idle' && (
                    <div className="state-overlay">
                        <div style={{ fontSize: '48px' }}>🇲🇬</div>
                        <h2>Prêt à rencontrer des Malagasy ?</h2>
                        <p>Clique sur Démarrer pour trouver un partenaire</p>
                        <button type="button" className="overlay-btn overlay-btn--primary" onClick={findPartner}>
                            Démarrer
                        </button>
                    </div>
                )}

                {status === 'waiting' && (
                    <div className="state-overlay">
                        <div style={{ fontSize: '40px' }}>⏳</div>
                        <h2>Recherche en cours…</h2>
                        <p>
                            {waitingTooLong
                                ? "Il n'y a personne pour le moment, mais on continue de chercher… 🇲🇬"
                                : "En attente d'un autre utilisateur"}
                        </p>
                        <button type="button" className="overlay-btn overlay-btn--muted" onClick={stop}>
                            Annuler
                        </button>
                    </div>
                )}

                {status === 'ended' && (
                    <div className="state-overlay">
                        <div style={{ fontSize: '40px' }}>👋</div>
                        <h2>La conversation est terminée</h2>
                        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
                            <button type="button" className="overlay-btn overlay-btn--primary" onClick={findPartner}>
                                Nouveau
                            </button>
                            <button type="button" className="overlay-btn overlay-btn--muted" onClick={stop}>
                                Arrêter
                            </button>
                        </div>
                    </div>
                )}

                {/* Autre utilisateur — gauche */}
                <div className="video-cell">
                    <video ref={remoteVideo} autoPlay playsInline />
                </div>

                {/* Moi — droite */}
                <div className="video-cell">
                    <video
                        ref={localVideo}
                        autoPlay
                        playsInline
                        muted
                        style={{ transform: 'scaleX(-1)' }}
                    />
                </div>
            </div>

            <div className="controls-row">
                <button
                    type="button"
                    className="btn-main btn-next"
                    disabled={status !== 'connected'}
                    onClick={skip}
                >
                    Next
                </button>
                <button type="button" className="btn-main btn-stop" onClick={stop}>
                    Stop
                </button>
                <button
                    type="button"
                    className={`small-btn${isMuted ? ' small-btn--off' : ''}`}
                    onClick={toggleMute}
                    title="Micro"
                    aria-label="Micro"
                >
                    {isMuted ? '🔇' : '🎤'}
                </button>
                <button
                    type="button"
                    className={`small-btn${isCamOff ? ' small-btn--off' : ''}`}
                    onClick={toggleCam}
                    title="Caméra"
                    aria-label="Caméra"
                >
                    {isCamOff ? '📵' : '📷'}
                </button>
            </div>

            <div className="chat-panel">
                <div className="chat-status">
                    <div className="chat-status-main">
                        <p className="chat-status-title">{statusLine()}</p>
                        <p className="chat-status-sub">{statusSub()}</p>
                    </div>
                    {status === 'connected' && (
                        <button type="button" className="report-link" onClick={reportUser}>
                            Signaler
                        </button>
                    )}
                </div>

                <div className="chat-messages">
                    {messages.length === 0 && (
                        <p className="chat-empty">
                            {status === 'connected'
                                ? 'Dis bonjour ! 👋'
                                : 'Les messages apparaîtront ici'}
                        </p>
                    )}
                    {messages.map((msg, i) => (
                        <div
                            key={i}
                            className={`msg-row${msg.self ? ' msg-row--self' : ' msg-row--other'}`}
                        >
                            {!msg.self && <span className="msg-from">{msg.from}</span>}
                            <div className={`msg-bubble${msg.self ? ' msg-bubble--self' : ' msg-bubble--other'}`}>
                                {msg.text}
                            </div>
                            <span className="msg-time">{msg.time}</span>
                        </div>
                    ))}
                    <div ref={messagesEnd} />
                </div>

                <form onSubmit={sendMessage} className="chat-input-row">
                    <input
                        value={inputMsg}
                        onChange={(e) => setInputMsg(e.target.value)}
                        placeholder={status === 'connected' ? 'Écrire un message…' : 'En attente…'}
                        disabled={status !== 'connected'}
                    />
                    <button type="submit" disabled={status !== 'connected'}>
                        Envoyer
                    </button>
                </form>
            </div>

            <div className="chat-ads">
                <AdSlot placement="video" minHeight={90} />
                <div style={{ height: 8 }} />
                <AdSlot placement="chat" minHeight={72} />
            </div>
        </div>
    );
}