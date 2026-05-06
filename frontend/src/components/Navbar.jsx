import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './Navbar.css';

export default function Navbar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const isHome = location.pathname === '/';
    const [open, setOpen] = useState(false);
    const menuRef = useRef(null);

    const handleLogout = () => {
        logout();
        setOpen(false);
        navigate('/');
    };

    useEffect(() => {
        function onDocClick(e) {
            if (!menuRef.current) return;
            if (!menuRef.current.contains(e.target)) setOpen(false);
        }
        function onEsc(e) {
            if (e.key === 'Escape') setOpen(false);
        }
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onEsc);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onEsc);
        };
    }, []);

    return (
        <header className={`wera-navbar ${isHome ? 'wera-navbar--home' : 'wera-navbar--app'}`}>
            <Link to="/" className="wera-navbar__logo">wera</Link>
            <nav className="wera-navbar__links" aria-label="Primary">
                {!user ? (
                    <>
                        <Link className="wera-navbar__link" to="/login">Se Connecter</Link>
                        <Link className="wera-navbar__link" to="/register">Nouveau compte</Link>
                    </>
                ) : (
                    <div className="wera-navbar__menu" ref={menuRef}>
                        <button
                            type="button"
                            className="wera-navbar__menubutton"
                            aria-haspopup="menu"
                            aria-expanded={open}
                            onClick={() => setOpen(v => !v)}
                        >
                            Salut, {user.username}
                        </button>
                        {open && (
                            <div className="wera-navbar__dropdown" role="menu" aria-label="Profil">
                                <Link
                                    className="wera-navbar__dropdownItem"
                                    role="menuitem"
                                    to="/profile"
                                    onClick={() => setOpen(false)}
                                >
                                    Profil
                                </Link>
                                <button
                                    className="wera-navbar__dropdownItem wera-navbar__dropdownItem--danger"
                                    role="menuitem"
                                    type="button"
                                    onClick={handleLogout}
                                >
                                    Déconnexion
                                </button>
                            </div>
                        )}
                    </div>
                )}

                <Link className="wera-navbar__link" to="/about">A Propos</Link>
                <Link className="wera-navbar__link" to="/contact">Contact</Link>
            </nav>
        </header>
    );
}