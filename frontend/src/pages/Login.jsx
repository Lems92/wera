import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';
import { API_URL } from '../config';
import { Container, Card, Form, Button, Alert } from 'react-bootstrap';

export default function Login() {
    const [form, setForm] = useState({ email: '', password: '' });
    const [error, setError] = useState('');
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const res = await axios.post(`${API_URL}/auth/login`, form);
            login(res.data.user, res.data.token);
            navigate('/');
        } catch (err) {
            setError(err.response?.data?.error || 'Erreur de connexion');
        }
    };

    return (
        <Container className="d-flex align-items-center justify-content-center" style={{ minHeight: 'calc(100vh - 72px)' }}>
            <Card className="shadow-sm border-0" style={{ maxWidth: '400px', width: '100%', borderRadius: '16px' }}>
                <Card.Body className="p-4 p-md-5">
                    <div className="text-center mb-4">
                        <span className="fw-bold px-3 py-1 border border-3 border-dark rounded-3" style={{ fontSize: '24px', letterSpacing: '-1px' }}>
                            wera
                        </span>
                        <h2 className="mt-4 h4 fw-bold">Se connecter</h2>
                    </div>

                    {error && (
                        <Alert variant="danger" className="py-2 small">
                            {error}
                        </Alert>
                    )}

                    <Form onSubmit={handleSubmit}>
                        <Form.Group className="mb-3">
                            <Form.Control
                                type="email"
                                placeholder="Email"
                                value={form.email}
                                onChange={e => setForm({ ...form, email: e.target.value })}
                                required
                                className="py-2 px-3"
                            />
                        </Form.Group>

                        <Form.Group className="mb-4">
                            <Form.Control
                                type="password"
                                placeholder="Mot de passe"
                                value={form.password}
                                onChange={e => setForm({ ...form, password: e.target.value })}
                                required
                                className="py-2 px-3"
                            />
                        </Form.Group>

                        <Button variant="warning" type="submit" className="w-100 fw-bold py-2 shadow-sm border-0 text-dark">
                            Se connecter
                        </Button>
                    </Form>

                    <div className="text-center mt-4">
                        <p className="text-muted small mb-0">
                            Pas encore de compte ?{' '}
                            <Link to="/register" className="text-dark fw-bold text-decoration-none border-bottom border-dark border-2">
                                S'inscrire
                            </Link>
                        </p>
                    </div>
                </Card.Body>
            </Card>
        </Container>
    );
}