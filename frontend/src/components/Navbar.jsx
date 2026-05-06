import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import './Navbar.css';

export default function Navbar() {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const isHome = location.pathname === '/';
    const [profileOpen, setProfileOpen] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const menuRef = useRef(null);
    const avatarLetter = (user?.username || '?').trim().charAt(0).toUpperCase();

    const handleLogout = () => {
        logout();
        setProfileOpen(false);
        setMobileOpen(false);
        navigate('/');
    };

    useEffect(() => {
        function onDocClick(e) {
            if (!menuRef.current) return;
            if (!menuRef.current.contains(e.target)) setProfileOpen(false);
        }
        function onEsc(e) {
            if (e.key !== 'Escape') return;
            setProfileOpen(false);
            setMobileOpen(false);
        }
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onEsc);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onEsc);
        };
    }, []);

    useEffect(() => {
        // Close the mobile menu when navigating.
        setMobileOpen(false);
        setProfileOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        // Prevent background scroll when mobile menu is open.
        if (!mobileOpen) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [mobileOpen]);

    return (
        <header className={`wera-navbar ${isHome ? 'wera-navbar--home' : 'wera-navbar--app'}`}>
            <Link to="/" className="wera-navbar__logo" aria-label="Wera">
                <img className="wera-navbar__logoImg" src="/logo.png" alt="Wera" />
            </Link>

            <button
                type="button"
                className="wera-navbar__burger"
                aria-label={mobileOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
                aria-expanded={mobileOpen}
                aria-controls="wera-mobile-menu"
                onClick={() => setMobileOpen(v => !v)}
            >
                <span className="wera-navbar__burgerIcon" aria-hidden="true" />
            </button>

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
                            className="wera-navbar__avatarButton"
                            aria-haspopup="menu"
                            aria-expanded={profileOpen}
                            onClick={() => setProfileOpen(v => !v)}
                            title="Profil"
                        >
                            <span className="wera-navbar__avatar" aria-hidden="true">
                                {avatarLetter}
                            </span>
                            <span className="wera-navbar__srOnly">Ouvrir le menu profil</span>
                        </button>
                        {profileOpen && (
                            <div className="wera-navbar__dropdown" role="menu" aria-label="Profil">
                                <Link
                                    className="wera-navbar__dropdownItem"
                                    role="menuitem"
                                    to="/profile"
                                    onClick={() => setProfileOpen(false)}
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

            {mobileOpen && <div className="wera-navbar__mobileOverlay" onClick={() => setMobileOpen(false)} />}
            <aside
                id="wera-mobile-menu"
                className={`wera-navbar__mobilePanel ${mobileOpen ? 'is-open' : ''}`}
                aria-hidden={!mobileOpen}
                aria-label="Menu"
            >
                <div className="wera-navbar__mobileLinks">
                    {!user ? (
                        <>
                            <Link className="wera-navbar__mobileLink" to="/login">Se Connecter</Link>
                            <Link className="wera-navbar__mobileLink" to="/register">Nouveau compte</Link>
                        </>
                    ) : (
                        <>
                            <Link className="wera-navbar__mobileLink" to="/profile">Profil</Link>
                            <button
                                type="button"
                                className="wera-navbar__mobileButton wera-navbar__mobileButton--danger"
                                onClick={handleLogout}
                            >
                                Déconnexion
                            </button>
                        </>
                    )}

                    <div className="wera-navbar__mobileDivider" aria-hidden="true" />

                    <Link className="wera-navbar__mobileLink" to="/about">A Propos</Link>
                    <Link className="wera-navbar__mobileLink" to="/contact">Contact</Link>
                </div>
            </aside>
        </header>
    );
}