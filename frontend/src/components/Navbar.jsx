import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Navbar, Nav, Container, Button } from 'react-bootstrap';

export default function AppNavbar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    return (
        <Navbar bg="white" expand="lg" className="border-bottom shadow-sm px-3">
            <Container fluid>
                <Navbar.Brand as={Link} to="/" className="fw-bold" style={{
                    fontSize: '22px', letterSpacing: '-1px',
                    border: '2.5px solid #111', borderRadius: '8px',
                    padding: '2px 10px', color: '#111'
                }}>
                    wera
                </Navbar.Brand>
                
                <Navbar.Toggle aria-controls="basic-navbar-nav" />
                
                <Navbar.Collapse id="basic-navbar-nav">
                    <Nav className="me-auto align-items-center">
                        {!user ? (
                            <>
                                <Nav.Link as={Link} to="/login" className="text-dark fw-medium">Se Connecter</Nav.Link>
                                <Nav.Link as={Link} to="/register" className="text-dark fw-medium">Nouveau Compte</Nav.Link>
                            </>
                        ) : (
                            <Navbar.Text className="text-dark fw-medium ms-lg-3">
                                Salut, {user.username} 👋
                            </Navbar.Text>
                        )}
                    </Nav>
                    <Nav className="align-items-center">
                        <Nav.Link as={Link} to="/about" className="text-dark fw-medium">A propos</Nav.Link>
                        <Nav.Link as={Link} to="/contact" className="text-dark fw-medium">Contact</Nav.Link>
                        {user && (
                            <Button 
                                variant="link" 
                                onClick={handleLogout} 
                                className="text-danger fw-medium text-decoration-none p-0 ms-lg-3"
                            >
                                Déconnexion
                            </Button>
                        )}
                    </Nav>
                </Navbar.Collapse>
            </Container>
        </Navbar>
    );
}