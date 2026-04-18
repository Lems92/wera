import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import Peer from 'peerjs';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { API_URL, SOCKET_URL } from '../config';

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

    const socketRef = useRef(null);
    const peerRef = useRef(null);
    const localStream = useRef(null);
    const localVideo = useRef(null);
    const remoteVideo = useRef(null);
    const currentCall = useRef(null);
    const messagesEnd = useRef(null);

    // Redirige si pas connecté
    useEffect(() => {
        if (!user) navigate('/login');
    }, [user]);

    // Initialise socket + caméra au montage
    useEffect(() => {
        initSocket();
        startCamera();
        return () => cleanup();
    }, []);

    // Auto-scroll messages
    useEffect(() => {
        messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const initSocket = () => {
        socketRef.current = io(SOCKET_URL);

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
            setStatus('ended'); 0
            setPartnerName('');
            if (remoteVideo.current) remoteVideo.current.srcObject = null;
            currentCall.current?.close();
        });

        socketRef.current.on('skipped', () => {
            setStatus('idle');
        });
    };

    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localStream.current = stream;
            if (localVideo.current) localVideo.current.srcObject = stream;
        } catch (err) {
            alert('Impossible d\'accéder à la caméra/micro. Autorise l\'accès dans ton navigateur.');
        }
    };

    const connectVideo = (partnerPeerId, initiator) => {
        const peer = new Peer();
        peerRef.current = peer;

        peer.on('open', () => {
            if (initiator) {
                const call = peer.call(partnerPeerId, localStream.current);
                currentCall.current = call;
                call.on('stream', (remoteStream) => {
                    if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream;
                });
            } else {
                peer.on('call', (call) => {
                    currentCall.current = call;
                    call.answer(localStream.current);
                    call.on('stream', (remoteStream) => {
                        if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream;
                    });
                });
            }
        });
    };

    const findPartner = () => {
        if (!localStream.current) return alert('Caméra non disponible');
        const peer = new Peer();
        peerRef.current = peer;

        peer.on('open', (peerId) => {
            socketRef.current.emit('find_partner', {
                peerId,
                username: user.username
            });
            setStatus('waiting');
        });
    };

    const skip = () => {
        currentCall.current?.close();
        peerRef.current?.destroy();
        if (remoteVideo.current) remoteVideo.current.srcObject = null;
        socketRef.current.emit('skip');
        findPartner();
    };

    const stop = () => {
        currentCall.current?.close();
        peerRef.current?.destroy();
        socketRef.current.emit('skip');
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
            display: 'grid',
            gridTemplateColumns: '1fr 320px',
            height: 'calc(100vh - 57px)',
            background: '#111'
        },
        videoSection: {
            display: 'flex', flexDirection: 'column',
            position: 'relative', background: '#000'
        },
        remoteVideo: {
            width: '100%', flex: 1,
            objectFit: 'cover', background: '#1a1a1a',
            display: 'block'
        },
        localVideo: {
            position: 'absolute', bottom: '80px', right: '16px',
            width: '160px', height: '120px',
            objectFit: 'cover', borderRadius: '12px',
            border: '2px solid #FFE000', background: '#222',
            zIndex: 10
        },
        controls: {
            height: '64px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: '12px', background: '#1a1a1a'
        },
        btn: (color) => ({
            padding: '10px 22px', borderRadius: '24px', border: 'none',
            cursor: 'pointer', fontWeight: '600', fontSize: '14px',
            background: color, color: color === '#FFE000' ? '#111' : '#fff',
            transition: 'opacity 0.2s'
        }),
        iconBtn: (active) => ({
            width: '44px', height: '44px', borderRadius: '50%', border: 'none',
            cursor: 'pointer', fontSize: '18px',
            background: active ? '#333' : '#e00',
            transition: 'background 0.2s'
        }),
        overlay: {
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: '1rem',
            background: '#111', zIndex: 5
        },
        chatSection: {
            display: 'flex', flexDirection: 'column',
            background: '#fff', borderLeft: '1px solid #e5e5e5'
        },
        chatHeader: {
            padding: '1rem', borderBottom: '1px solid #e5e5e5',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between'
        },
        messages: {
            flex: 1, overflowY: 'auto',
            padding: '1rem', display: 'flex',
            flexDirection: 'column', gap: '8px'
        },
        bubble: (self) => ({
            maxWidth: '80%', padding: '8px 12px', borderRadius: '12px',
            fontSize: '14px', lineHeight: 1.4,
            alignSelf: self ? 'flex-end' : 'flex-start',
            background: self ? '#FFE000' : '#f0f0f0',
            color: '#111'
        }),
        chatInput: {
            display: 'flex', padding: '0.75rem',
            borderTop: '1px solid #e5e5e5', gap: '8px'
        }
    };

    return (
        <div style={s.page}>

            {/* ── Section vidéo ── */}
            <div style={s.videoSection}>

                {/* Overlay état */}
                {status === 'idle' && (
                    <div style={s.overlay}>
                        <div style={{ fontSize: '48px' }}>🇲🇬</div>
                        <h2 style={{ color: '#fff', fontSize: '22px' }}>Prêt à rencontrer des Malagasy ?</h2>
                        <p style={{ color: '#aaa', fontSize: '14px' }}>Clique sur Démarrer pour trouver un partenaire</p>
                        <button style={s.btn('#FFE000')} onClick={findPartner}>
                            Démarrer
                        </button>
                    </div>
                )}

                {status === 'waiting' && (
                    <div style={s.overlay}>
                        <div style={{ fontSize: '40px', animation: 'spin 1s linear infinite' }}>⏳</div>
                        <h2 style={{ color: '#fff' }}>Recherche en cours...</h2>
                        <p style={{ color: '#aaa', fontSize: '14px' }}>En attente d'un autre utilisateur</p>
                        <button style={s.btn('#555')} onClick={stop}>Annuler</button>
                    </div>
                )}

                {status === 'ended' && (
                    <div style={s.overlay}>
                        <div style={{ fontSize: '40px' }}>👋</div>
                        <h2 style={{ color: '#fff' }}>La conversation est terminée</h2>
                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button style={s.btn('#FFE000')} onClick={findPartner}>Nouveau</button>
                            <button style={s.btn('#333')} onClick={stop}>Arrêter</button>
                        </div>
                    </div>
                )}

                {/* Vidéo distante */}
                <video ref={remoteVideo} autoPlay playsInline style={s.remoteVideo} />

                {/* Vidéo locale (petite) */}
                <video ref={localVideo} autoPlay playsInline muted style={s.localVideo} />

                {/* Contrôles */}
                <div style={s.controls}>
                    <button style={s.iconBtn(!isMuted)} onClick={toggleMute} title="Micro">
                        {isMuted ? '🔇' : '🎤'}
                    </button>
                    <button style={s.iconBtn(!isCamOff)} onClick={toggleCam} title="Caméra">
                        {isCamOff ? '📵' : '📷'}
                    </button>
                    {status === 'connected' && (
                        <>
                            <button style={s.btn('#FFE000')} onClick={skip}>⏭ Suivant</button>
                            <button style={s.btn('#e00')} onClick={stop}>✖ Stop</button>
                        </>
                    )}
                </div>
            </div>

            {/* ── Section chat texte ── */}
            <div style={s.chatSection}>
                <div style={s.chatHeader}>
                    <div>
                        <p style={{ fontWeight: '600', fontSize: '15px' }}>
                            {status === 'connected' ? `💬 ${partnerName}` : 'Chat'}
                        </p>
                        <p style={{ fontSize: '12px', color: '#888' }}>
                            {status === 'connected' ? 'En ligne' : 'Pas connecté'}
                        </p>
                    </div>
                    {status === 'connected' && (
                        <button
                            onClick={reportUser}
                            style={{
                                background: 'none', border: '1px solid #e00',
                                color: '#e00', borderRadius: '8px',
                                padding: '4px 10px', fontSize: '12px', cursor: 'pointer'
                            }}
                        >
                            🚩 Signaler
                        </button>
                    )}
                </div>

                <div style={s.messages}>
                    {messages.length === 0 && (
                        <p style={{ color: '#ccc', fontSize: '13px', textAlign: 'center', marginTop: '2rem' }}>
                            {status === 'connected'
                                ? 'Dis bonjour ! 👋'
                                : 'Les messages apparaîtront ici'}
                        </p>
                    )}
                    {messages.map((msg, i) => (
                        <div key={i} style={{ alignSelf: msg.self ? 'flex-end' : 'flex-start', maxWidth: '80%' }}>
                            {!msg.self && (
                                <p style={{ fontSize: '11px', color: '#888', marginBottom: '2px' }}>{msg.from}</p>
                            )}
                            <div style={s.bubble(msg.self)}>{msg.text}</div>
                            <p style={{
                                fontSize: '11px', color: '#bbb', marginTop: '2px',
                                textAlign: msg.self ? 'right' : 'left'
                            }}>{msg.time}</p>
                        </div>
                    ))}
                    <div ref={messagesEnd} />
                </div>

                <form onSubmit={sendMessage} style={s.chatInput}>
                    <input
                        value={inputMsg}
                        onChange={e => setInputMsg(e.target.value)}
                        placeholder={status === 'connected' ? 'Écrire un message...' : 'En attente...'}
                        disabled={status !== 'connected'}
                        style={{
                            flex: 1, padding: '8px 12px', borderRadius: '20px',
                            border: '1px solid #ddd', fontSize: '14px', outline: 'none'
                        }}
                    />
                    <button
                        type="submit"
                        disabled={status !== 'connected'}
                        style={{
                            background: '#FFE000', border: 'none', borderRadius: '20px',
                            padding: '8px 16px', cursor: 'pointer',
                            fontWeight: '600', fontSize: '14px', color: '#111'
                        }}
                    >
                        ➤
                    </button>
                </form>
            </div>

        </div>
    );
}