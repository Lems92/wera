import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Navbar, Nav, Container, Button } from 'react-bootstrap';

export default function AppNavbar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const isHome = location.pathname === '/';

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    return (
        <Navbar 
            expand="lg" 
            className={`px-3 py-2 ${isHome ? 'position-absolute w-100 top-0 start-0 z-3 bg-transparent border-0 mt-3' : 'bg-white border-bottom shadow-sm'}`}
        >
            <Container className={isHome ? 'bg-white rounded-pill shadow-sm px-4 py-2 mt-md-2' : ''}>
                <Navbar.Brand as={Link} to="/" className="d-flex align-items-center">
                    <img 
                        src="/logo.png" 
                        alt="Wera" 
                        height="40" 
                        className="me-2"
                    />
                </Navbar.Brand>
                
                <Navbar.Toggle aria-controls="basic-navbar-nav" />
                
                <Navbar.Collapse id="basic-navbar-nav">
                    <Nav className="mx-auto align-items-center gap-lg-4">
                        {!user ? (
                            <>
                                <Nav.Link as={Link} to="/login" className="text-dark fw-bold small">Se Connecter</Nav.Link>
                                <Nav.Link as={Link} to="/register" className="text-dark fw-bold small">Nouveau compte</Nav.Link>
                            </>
                        ) : (
                            <Navbar.Text className="text-dark fw-bold small ms-lg-3">
                                Salut, {user.username} 👋
                            </Navbar.Text>
                        )}
                    </Nav>
                    <Nav className="align-items-center gap-lg-4">
                        <Nav.Link as={Link} to="/about" className="text-dark fw-bold small">A Propos</Nav.Link>
                        <Nav.Link as={Link} to="/contact" className="text-dark fw-bold small">Contact</Nav.Link>
                        {user && (
                            <Button 
                                variant="link" 
                                onClick={handleLogout} 
                                className="text-danger fw-bold small text-decoration-none p-0 ms-lg-3"
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