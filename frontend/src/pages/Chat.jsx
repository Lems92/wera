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
    };    return (
        <div className="bg-dark text-white overflow-hidden d-flex flex-column" style={{ height: 'calc(100vh - 72px)' }}>
            
            {/* Main Area with Responsive Split */}
            <Container fluid className="flex-grow-1 p-0 d-flex flex-column overflow-hidden">
                <Row className="g-0 flex-grow-1 h-100 flex-column flex-md-row">
                    
                    {/* TOP SECTION (Mobile) / LEFT SECTION (PC) : Partner or UI */}
                    <Col md={6} className="h-50 h-md-100 bg-black position-relative border-bottom border-end border-secondary d-flex flex-column align-items-center justify-content-center overflow-hidden">
                        
                        {status === 'connected' ? (
                            <video ref={remoteVideo} autoPlay playsInline className="w-100 h-100 object-fit-cover" />
                        ) : (
                            <div className="w-100 h-100 d-flex flex-column align-items-center justify-content-center p-3 text-center">
                                {/* OmeTV Style Logo Area */}
                                <div className="mb-4 d-flex flex-column align-items-center">
                                    <div className="border border-warning border-4 rounded-4 p-2 mb-2 d-flex flex-column align-items-center" style={{ width: '120px', background: 'rgba(255, 193, 7, 0.1)' }}>
                                        <span className="fw-bold h2 mb-0 text-warning">Wera</span>
                                        <span className="fw-bold h4 mb-0 text-success">TV</span>
                                    </div>
                                    <div className="d-flex align-items-center gap-2">
                                        <Badge bg="success" pill className="p-1" style={{ width: '10px', height: '10px' }}> </Badge>
                                        <span className="small fw-bold">{onlineCount.toLocaleString()} Users online</span>
                                    </div>
                                </div>

                                {/* Filters (OmeTV Mobile Style) */}
                                <div className="d-flex gap-2 w-100 px-2" style={{ maxWidth: '400px' }}>
                                    <Button variant="outline-light" className="flex-grow-1 d-flex justify-content-between align-items-center py-2 px-3 border-secondary bg-dark bg-opacity-50">
                                        <small className="fw-bold text-uppercase opacity-75">Country:</small>
                                        <span className="fs-4">🇲🇬</span>
                                    </Button>
                                    <Button variant="outline-light" className="flex-grow-1 d-flex justify-content-between align-items-center py-2 px-3 border-secondary bg-dark bg-opacity-50">
                                        <small className="fw-bold text-uppercase opacity-75">I am:</small>
                                        <span className="fs-4">👤</span>
                                    </Button>
                                </div>

                                {status === 'waiting' && (
                                    <div className="mt-4">
                                        <Spinner animation="border" variant="warning" size="sm" className="me-2" />
                                        <small className="fw-bold text-warning">Recherche...</small>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Chat Overlay (PC style or when connected) */}
                        {status === 'connected' && (
                            <div className="position-absolute bottom-0 start-0 w-100 p-3 pointer-events-none d-flex flex-column gap-1" style={{ maxHeight: '40%', overflowY: 'auto', background: 'linear-gradient(transparent, rgba(0,0,0,0.7))' }}>
                                {messages.slice(-3).map((msg, i) => (
                                    <div key={i} className="small">
                                        <span className={msg.self ? 'text-warning fw-bold' : 'text-white fw-bold'}>{msg.self ? 'Moi' : msg.from}: </span>
                                        <span>{msg.text}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Col>

                    {/* BOTTOM SECTION (Mobile) / RIGHT SECTION (PC) : Local Video */}
                    <Col md={6} className="h-50 h-md-100 bg-black position-relative d-flex align-items-center justify-content-center overflow-hidden">
                        <video 
                            ref={localVideo} 
                            autoPlay 
                            playsInline 
                            muted 
                            className="w-100 h-100 object-fit-cover"
                        />
                        
                        {/* State Overlays */}
                        {status === 'idle' && (
                            <div className="position-absolute inset-0 d-flex flex-column align-items-center justify-content-center bg-black bg-opacity-50">
                                <Button variant="success" size="lg" className="rounded-pill px-5 py-3 fw-bold shadow-lg" onClick={findPartner}>
                                    DÉMARRER
                                </Button>
                            </div>
                        )}

                        {/* Rules Overlay */}
                        <div className="position-absolute bottom-0 start-0 w-100 p-2 text-center text-white-50 small" style={{ fontSize: '9px', background: 'rgba(0,0,0,0.3)' }}>
                            By using this videochat you agree with our rules. Rules violators will be banned.
                        </div>

                        {/* Quick Controls on Mobile */}
                        {status === 'connected' && (
                            <div className="position-absolute top-0 end-0 p-3 d-flex flex-column gap-2 d-md-none" style={{ zIndex: 100 }}>
                                <Button variant="primary" className="rounded-circle p-0 d-flex align-items-center justify-content-center" style={{ width: '45px', height: '45px' }} onClick={skip}>⏭</Button>
                                <Button variant="danger" className="rounded-circle p-0 d-flex align-items-center justify-content-center" style={{ width: '45px', height: '45px' }} onClick={stop}>✖</Button>
                            </div>
                        )}
                    </Col>
                </Row>

                {/* Controls & Chat Input (PC / Bottom) */}
                <div className="bg-black border-top border-secondary p-2 p-md-3 mt-auto shadow-lg" style={{ zIndex: 20 }}>
                    <Row className="align-items-center g-2 max-width-1200 mx-auto w-100">
                        <Col xs="auto" className="d-none d-md-block">
                            <Button variant="danger" onClick={stop} className="fw-bold px-4 rounded-3">STOP</Button>
                        </Col>
                        <Col xs="auto" className="d-none d-md-block">
                            <Button variant="primary" onClick={skip} className="fw-bold px-4 rounded-3">SUIVANT</Button>
                        </Col>
                        <Col className="position-relative px-md-4">
                            <Form onSubmit={sendMessage} className="d-flex gap-2">
                                <Form.Control
                                    value={inputMsg}
                                    onChange={e => setInputMsg(e.target.value)}
                                    placeholder={status === 'connected' ? "Écrire un message..." : "Connectez-vous pour chanter"}
                                    disabled={status !== 'connected'}
                                    className="bg-dark text-white border-secondary rounded-pill px-4 py-2"
                                />
                                <Button variant="warning" type="submit" disabled={status !== 'connected'} className="rounded-circle d-flex align-items-center justify-content-center border-0 shadow-sm" style={{ width: '42px', height: '42px' }}>
                                    ➤
                                </Button>
                            </Form>
                        </Col>
                    </Row>
                </div>
            </Container>

            {/* Bottom Nav (OmeTV Style Icons) */}
            <div className="bg-black py-2 d-flex justify-content-around border-top border-secondary d-md-none" style={{ background: '#0a0a0a' }}>
                <Button variant="link" className="text-secondary p-0 fs-3 opacity-50">👤</Button>
                <Button variant="link" className="text-secondary p-0 fs-3 opacity-50">🔍</Button>
                <Button variant="link" className="text-success p-0 fs-3">📺</Button>
                <Button variant="link" className="text-secondary p-0 fs-3 opacity-50">✉️</Button>
                <Button variant="link" className="text-secondary p-0 fs-3 opacity-50">🖼️</Button>
            </div>
        </div>
    );
}
