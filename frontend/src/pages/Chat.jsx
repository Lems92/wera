import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import Peer from 'peerjs';
import { useAuth } from '../context/AuthContext';
import axios from 'axios';
import { API_URL, SOCKET_URL } from '../config';
import { Container, Row, Col, Button, Form, Spinner, Badge } from 'react-bootstrap';

export default function Chat() {
    const { user, token } = useAuth();
    const navigate = useNavigate();

    const [status, setStatus] = useState('idle');
    const [messages, setMessages] = useState([]);
    const [inputMsg, setInputMsg] = useState('');
    const [partnerName, setPartnerName] = useState('');
    const [isMuted, setIsMuted] = useState(false);
    const [isCamOff, setIsCamOff] = useState(false);
    const [waitingTooLong, setWaitingTooLong] = useState(false);
    const [onlineCount] = useState(77188); // Mock value

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
            waitingTimerRef.current = setTimeout(() => {
                setWaitingTooLong(true);
            }, 120000);
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
            transports: ['polling'],
            upgrade: false,
            withCredentials: true,
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 500,
            timeout: 20000
        });

        socketRef.current.on('connect', () => {
            if (statusRef.current === 'waiting' || pendingFindRef.current) {
                maybeStartSearch(true);
            }
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
        } catch (err) {
            alert('Impossible d\'accéder à la caméra/micro.');
        }
    };

    const connectVideo = (partnerPeerId, initiator) => {
        const peer = peerRef.current;
        if (!peer || !peerIdRef.current || !localStream.current) return;

        if (initiator) {
            currentCall.current?.close();
            const call = peer.call(partnerPeerId, localStream.current);
            currentCall.current = call;
            call.on('stream', (remoteStream) => {
                if (remoteVideo.current) remoteVideo.current.srcObject = remoteStream;
            });
        }
    };

    const findPartner = () => {
        if (!localStream.current) return alert('Caméra non disponible');
        pendingFindRef.current = true;
        maybeStartSearch();
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

    const cleanup = () => {
        localStream.current?.getTracks().forEach(t => t.stop());
        socketRef.current?.disconnect();
        peerRef.current?.destroy();
    };

    return (
        <div className="bg-dark text-white overflow-hidden d-flex flex-column" style={{ height: 'calc(100vh - 72px)' }}>
            {/* Header / Stats */}
            <div className="bg-black py-2 px-3 d-flex align-items-center justify-content-between border-bottom border-secondary">
                <div className="d-flex align-items-center gap-2">
                    <Badge bg="success" pill className="p-1" style={{ width: '10px', height: '10px' }}> </Badge>
                    <small className="fw-bold">{onlineCount.toLocaleString()} en ligne</small>
                </div>
                <div className="d-flex gap-2">
                    <Button variant="outline-light" size="sm" className="py-0 px-2 fw-bold small border-secondary text-uppercase">🇲🇬 Pays</Button>
                    <Button variant="outline-light" size="sm" className="py-0 px-2 fw-bold small border-secondary text-uppercase">👤 Genre</Button>
                </div>
            </div>

            {/* Main Area */}
            <Container fluid className="flex-grow-1 p-0 position-relative d-flex flex-column">
                <Row className="g-0 flex-grow-1">
                    {/* Partner Video */}
                    <Col md={6} className="bg-black position-relative border-end border-secondary d-flex align-items-center justify-content-center overflow-hidden">
                        <video ref={remoteVideo} autoPlay playsInline className="w-100 h-100 object-fit-cover" />
                        
                        {/* Status Overlays */}
                        {status === 'waiting' && (
                            <div className="position-absolute inset-0 d-flex flex-column align-items-center justify-content-center bg-black bg-opacity-75 text-center p-3">
                                <Spinner animation="border" variant="warning" className="mb-3" />
                                <h3 className="fw-bold">Recherche...</h3>
                                <p className="text-muted small">
                                    {waitingTooLong ? "Un peu de patience... 🇲🇬" : "Recherche d'un partenaire en cours"}
                                </p>
                            </div>
                        )}
                        {status === 'idle' && (
                            <div className="position-absolute inset-0 d-flex flex-column align-items-center justify-content-center bg-black bg-opacity-75">
                                <Button variant="success" size="lg" pill className="px-5 py-3 fw-bold shadow-lg" onClick={findPartner}>
                                    DÉMARRER
                                </Button>
                            </div>
                        )}

                        {/* Chat Overlay on Partner Video (PC view mostly) */}
                        <div className="position-absolute bottom-0 start-0 w-100 p-3 pointer-events-none d-none d-md-flex flex-column gap-1" style={{ maxHeight: '40%', overflowY: 'auto', background: 'linear-gradient(transparent, rgba(0,0,0,0.7))' }}>
                            {messages.slice(-5).map((msg, i) => (
                                <div key={i} className="small">
                                    <span className={msg.self ? 'text-warning fw-bold' : 'text-white fw-bold'}>{msg.self ? 'Moi' : msg.from}: </span>
                                    <span>{msg.text}</span>
                                </div>
                            ))}
                        </div>
                    </Col>

                    {/* Local Video */}
                    <Col md={6} className="bg-black position-relative d-flex align-items-center justify-content-center overflow-hidden">
                        <video ref={localVideo} autoPlay playsInline muted className="w-100 h-100 object-fit-cover d-none d-md-block" />
                        {/* Mobile view overlay for local camera */}
                        <video ref={localVideo} autoPlay playsInline muted className="position-absolute top-2 end-2 border border-secondary rounded shadow-lg d-md-none" style={{ width: '100px', height: '130px', objectFit: 'cover', zIndex: 10 }} />
                        
                        {/* Rules/Info */}
                        <div className="position-absolute bottom-0 start-0 w-100 p-2 text-center text-secondary small d-none d-md-block" style={{ fontSize: '10px' }}>
                            En utilisant ce chat, vous acceptez nos règles. Les contrevenants seront bannis.
                        </div>
                    </Col>
                </Row>

                {/* Controls & Chat Input */}
                <div className="bg-black border-top border-secondary p-2 p-md-3 mt-auto">
                    <Row className="align-items-center g-2">
                        <Col xs="auto">
                            <Button variant="danger" onClick={stop} className="fw-bold px-3">STOP</Button>
                        </Col>
                        <Col xs="auto">
                            <Button variant="primary" onClick={skip} className="fw-bold px-3">SUIVANT</Button>
                        </Col>
                        <Col className="position-relative">
                            <Form onSubmit={sendMessage} className="d-flex gap-2">
                                <Form.Control
                                    value={inputMsg}
                                    onChange={e => setInputMsg(e.target.value)}
                                    placeholder="Écrire un message..."
                                    disabled={status !== 'connected'}
                                    className="bg-dark text-white border-secondary rounded-pill px-4 py-2"
                                />
                                <Button variant="warning" type="submit" disabled={status !== 'connected'} className="rounded-circle d-flex align-items-center justify-content-center" style={{ width: '42px', height: '42px' }}>
                                    ➤
                                </Button>
                            </Form>
                        </Col>
                    </Row>
                </div>
            </Container>

            {/* Bottom Nav (Mobile style icons) */}
            <div className="bg-black py-2 d-flex justify-content-around border-top border-secondary d-md-none">
                <Button variant="link" className="text-secondary p-0 fs-4">👤</Button>
                <Button variant="link" className="text-secondary p-0 fs-4">🔍</Button>
                <Button variant="link" className="text-warning p-0 fs-4">📺</Button>
                <Button variant="link" className="text-secondary p-0 fs-4">✉️</Button>
                <Button variant="link" className="text-secondary p-0 fs-4">🖼️</Button>
            </div>
        </div>
    );
}