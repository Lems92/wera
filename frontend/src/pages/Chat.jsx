import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import Peer from 'peerjs';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { API_URL, SOCKET_URL } from '../config';
import './Chat.css';

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
    const [partnerId, setPartnerId] = useState(null);

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
    const stopInitiatedRef = useRef(false);

    useEffect(() => { userRef.current = user; }, [user]);
    useEffect(() => { statusRef.current = status; }, [status]);

    useEffect(() => {
        if (!user) navigate('/login');
    }, [user, navigate]);

    useEffect(() => {
        initSocket();
        startCamera();
        initPeer();
        return () => cleanup();
    }, []);

    useEffect(() => {
        messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    useEffect(() => {
        if (status === 'waiting') {
            waitingTimerRef.current = setTimeout(() => setWaitingTooLong(true), 120000);
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
            transports: ['polling', 'websocket'],
            // The wera_token HttpOnly cookie is sent during the polling
            // handshake; the server's io.use middleware reads it from there.
            // We still pass auth.token as a fallback for environments where
            // a third-party cookie may be blocked.
            withCredentials: true,
            auth: token ? { token } : undefined,
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            timeout: 60000
        });

        socketRef.current.on('connect', () => {
            if (statusRef.current === 'waiting' || pendingFindRef.current) {
                maybeStartSearch(true);
            }
        });

        socketRef.current.on('connect_error', (err) => {
            console.error('Socket connect_error:', err?.message || err);
        });

        socketRef.current.on('waiting', () => {
            if (statusRef.current !== 'connected') setStatus('waiting');
        });

        socketRef.current.on('partner_found', ({ partnerPeerId, partnerUsername, partnerUserId, initiator }) => {
            pendingFindRef.current = false;
            stopInitiatedRef.current = false;
            // Defensive: keep only a short, plain-text-ish slice to display.
            // The server already validates the username at registration but
            // this prevents any future regression from spilling into the UI.
            const safeName = String(partnerUsername || '').replace(/[<>]/g, '').slice(0, 40);
            setPartnerName(safeName);
            setPartnerId(partnerUserId || null);
            setStatus('connected');
            setMessages([]);
            connectVideo(partnerPeerId, initiator);
        });

        socketRef.current.on('receive_message', (msg) => {
            setMessages(prev => [...prev, { ...msg, self: false }]);
        });

        socketRef.current.on('partner_left', () => {
            setPartnerName('');
            setPartnerId(null);
            if (remoteVideo.current) remoteVideo.current.srcObject = null;
            currentCall.current?.close();
            // If *we* stopped the conversation, do NOT restart matchmaking.
            // Otherwise (partner left / partner stopped / disconnect), keep matching.
            if (stopInitiatedRef.current) {
                stopInitiatedRef.current = false;
                pendingFindRef.current = false;
                statusRef.current = 'idle';
                setStatus('idle');
                return;
            }
            findPartner();
        });

        socketRef.current.on('skipped', () => {
            // cancel_search ack or server-side cleanup: always settle to idle
            // unless we're already in a call.
            pendingFindRef.current = false;
            if (statusRef.current !== 'connected') setStatus('idle');
        });
    };

    const maybeStartSearch = (force = false) => {
        const socket = socketRef.current;
        const u = userRef.current;
        if (statusRef.current === 'connected') {
            pendingFindRef.current = false;
            return;
        }
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
        const peerServerUrl = new URL(SOCKET_URL);
        const peer = new Peer(undefined, {
            host: peerServerUrl.hostname,
            port: peerServerUrl.port ? Number(peerServerUrl.port) : (peerServerUrl.protocol === 'https:' ? 443 : 80),
            secure: peerServerUrl.protocol === 'https:',
            path: '/peerjs',
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
            if (!localStream.current) return;
            currentCall.current = call;
            call.answer(localStream.current);
            call.on('stream', (remoteStream) => {
                if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream;
            });
        });

        peer.on('error', (err) => console.error('Peer error:', err));
        peer.on('disconnected', () => {
            try { peer.reconnect(); } catch { /* ignore */ }
        });
    };

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localStream.current = stream;
            if (localVideo.current) localVideo.current.srcObject = stream;
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
        setStatus('waiting');
        maybeStartSearch();
        // If peer/socket aren't ready yet, UI still shows "Recherche..." and auto-starts when ready.
        setStatus('waiting');
    };

    const skip = () => {
        stopInitiatedRef.current = false;
        currentCall.current?.close();
        if (remoteVideo.current) remoteVideo.current.srcObject = null;
        setPartnerName('');
        setPartnerId(null);
        setMessages([]);
        socketRef.current.emit('skip');
        findPartner();
    };

    const stop = () => {
        currentCall.current?.close();
        pendingFindRef.current = false;
        if (status === 'waiting') {
            socketRef.current.emit('cancel_search');
            statusRef.current = 'idle';
            setStatus('idle');
        } else if (status === 'connected') {
            // Stop pendant l'appel: on libère la paire côté serveur.
            // L'autre utilisateur continue (il reçoit partner_left et relance sa recherche),
            // mais celui qui appuie sur Stop revient en "idle" sans relancer le matchmaking.
            stopInitiatedRef.current = true;
            socketRef.current.emit('skip');
            if (remoteVideo.current) remoteVideo.current.srcObject = null;
            setPartnerName('');
            setMessages([]);
            setPartnerId(null);
            statusRef.current = 'idle';
            setStatus('idle');
            return;
        } else {
            socketRef.current.emit('skip');
        }
        if (remoteVideo.current) remoteVideo.current.srcObject = null;
        statusRef.current = 'idle';
        setStatus('idle');
        setMessages([]);
        setPartnerName('');
        setPartnerId(null);
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
        if (!partnerId) {
            alert('Impossible de signaler : utilisateur inconnu.');
            return;
        }
        if (!window.confirm('Signaler cet utilisateur ?')) return;
        try {
            await axios.post(`${API_URL}/reports`,
                { reported_id: partnerId, reason: 'Comportement inapproprié' },
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

    const remoteBadge = () => {
        if (status === 'connected') return null;
        if (status === 'waiting') {
            return waitingTooLong ? 'Toujours personne… on cherche' : 'Connexion…';
        }
        if (status === 'ended') return 'Conversation terminée';
        return 'En attente';
    };

    return (
        <div className="ome-page">
            <button
                type="button"
                className="ome-back"
                onClick={() => navigate(-1)}
                aria-label="Retour"
            >
                ← Retour
            </button>

            <div className="ome-stage">
                {/* ── VIDÉO REMOTE ── */}
                <section className="ome-remote">
                    <video ref={remoteVideo} autoPlay playsInline className="ome-video" />
                    <span className="ome-tag ome-tag--top">Stranger</span>
                    {remoteBadge() && (
                        <div className="ome-overlay">
                            <span className="ome-overlay__dot" />
                            <span>{remoteBadge()}</span>
                        </div>
                    )}
                    {status === 'connected' && (
                        <button
                            type="button"
                            className="ome-report"
                            onClick={reportUser}
                            aria-label="Signaler"
                        >
                            🚩
                        </button>
                    )}
                </section>

                {/* ── Ligne de séparation jaune ── */}
                <div className="ome-divider" />

                {/* ── VIDÉO LOCALE ── */}
                <section className="ome-local">
                    <video
                        ref={localVideo}
                        autoPlay
                        playsInline
                        muted
                        className="ome-video ome-video--mirrored"
                    />
                    <span className="ome-tag ome-tag--bottom">You</span>
                    {isCamOff && <div className="ome-camoff">Caméra désactivée</div>}
                </section>

                {/* ── CONTRÔLES (overlay flottant) ── */}
                <div className="ome-controls">
                    <button
                        type="button"
                        className={`ome-btn ome-btn--icon${isMuted ? ' is-off' : ''}`}
                        onClick={toggleMute}
                        aria-label="Micro"
                    >
                        {isMuted ? '🔇' : '🎤'}
                    </button>
                    <button
                        type="button"
                        className={`ome-btn ome-btn--icons${isCamOff ? ' is-off' : ''}`}
                        onClick={toggleCam}
                        aria-label="Caméra"
                    >
                        {isCamOff ? '📵' : '📷'}
                    </button>
                    <button
                        type="button"
                        className="ome-btn ome-btn--next"
                        onClick={status === 'idle' ? findPartner : skip}
                        aria-label="Suivant"
                    >
                        {status === 'idle' ? 'Start' : 'Next'}
                    </button>
                    <button
                        type="button"
                        className="ome-btn ome-btn--stop"
                        onClick={stop}
                        aria-label="Stop"
                    >
                        ✖
                    </button>
                </div>
            </div>

            {/* ── CHAT FIXE EN BAS (desktop + mobile) ── */}
            <section className="ome-chatFixed" aria-label="Chat">
                <header className="ome-chat__header">
                    <span>{status === 'connected' ? `💬 ${partnerName || 'Stranger'}` : 'Chat'}</span>
                </header>

                <div className="ome-chat__messages">
                    {messages.length === 0 && (
                        <p className="ome-chat__empty">
                            {status === 'connected'
                                ? 'Dis bonjour ! 👋'
                                : 'Les messages apparaîtront ici'}
                        </p>
                    )}
                    {messages.map((msg, i) => (
                        <div
                            key={i}
                            className={`ome-msg${msg.self ? ' ome-msg--self' : ''}`}
                        >
                            {!msg.self && <span className="ome-msg__from">{msg.from}</span>}
                            <div className="ome-msg__bubble">{msg.text}</div>
                            <span className="ome-msg__time">{msg.time}</span>
                        </div>
                    ))}
                    <div ref={messagesEnd} />
                </div>

                <form onSubmit={sendMessage} className="ome-chat__input">
                    <input
                        value={inputMsg}
                        onChange={(e) => setInputMsg(e.target.value)}
                        placeholder={status === 'connected' ? 'Écrire un message…' : 'En attente…'}
                        disabled={status !== 'connected'}
                    />
                    <button type="submit" disabled={status !== 'connected'} aria-label="Envoyer">
                        ➤
                    </button>
                </form>
            </section>

        </div>
    );
}
