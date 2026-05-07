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
    const [userMenuOpen, setUserMenuOpen] = useState(false);
    const userMenuRef = useRef(null);

    // Close menu when route changes
    useEffect(() => {
        setOpen(false);
    }, [location.pathname]);

    // Lock body scroll while the mobile menu is open
    useEffect(() => {
        if (!open) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [open]);

    // Close on Escape key
    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open]);

    // Close user dropdown on outside click / Escape
    useEffect(() => {
        if (!userMenuOpen) return;
        const onDown = (e) => {
            const el = userMenuRef.current;
            if (!el) return;
            if (el.contains(e.target)) return;
            setUserMenuOpen(false);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') setUserMenuOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('touchstart', onDown, { passive: true });
        window.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('touchstart', onDown);
            window.removeEventListener('keydown', onKey);
        };
    }, [userMenuOpen]);

    const handleLogout = () => {
        logout();
        setOpen(false);
        setUserMenuOpen(false);
        navigate('/');
    };

    const close = () => setOpen(false);
    const initials = (user?.username?.[0]?.toUpperCase() || '?');

    return (
        <>
            <header className={`wera-navbar ${isHome ? 'wera-navbar--home' : 'wera-navbar--app'}`}>
                <Link to="/" className="wera-navbar__logo" onClick={close}><img src="/logo.png" alt="Wera" className="wera-navbar__logoImg" /></Link>

                {/* Desktop links */}
                <nav className="wera-navbar__links" aria-label="Primary">
                    {!user ? (
                        <>
                            <Link className="wera-navbar__link" to="/login">Se Connecter</Link>
                            <Link className="wera-navbar__link" to="/register">Nouveau compte</Link>
                        </>
                    ) : (
                        <div className="wera-userMenu" ref={userMenuRef}>
                            <button
                                type="button"
                                className="wera-userMenu__trigger"
                                onClick={() => setUserMenuOpen(v => !v)}
                                aria-label="Menu utilisateur"
                                aria-haspopup="menu"
                                aria-expanded={userMenuOpen}
                            >
                                <span className="wera-userMenu__avatar" aria-hidden="true">{initials}</span>
                            </button>

                            <div className={`wera-userMenu__dropdown${userMenuOpen ? ' is-open' : ''}`} role="menu" aria-hidden={!userMenuOpen}>
                                <button
                                    type="button"
                                    className="wera-userMenu__item"
                                    onClick={() => { setUserMenuOpen(false); navigate('/profile'); }}
                                    role="menuitem"
                                >
                                    Profil
                                </button>
                                <button
                                    type="button"
                                    className="wera-userMenu__item wera-userMenu__item--danger"
                                    onClick={handleLogout}
                                    role="menuitem"
                                >
                                    Déconnexion
                                </button>
                            </div>
                        </div>
                    )}

                    <Link className="wera-navbar__link" to="/about">A Propos</Link>
                    <Link className="wera-navbar__link" to="/contact">Contact</Link>

                    {/* Logout moved into avatar dropdown on desktop */}
                </nav>

                {/* Burger button (mobile only) */}
                <button
                    type="button"
                    className={`wera-burger${open ? ' is-open' : ''}`}
                    onClick={() => setOpen(o => !o)}
                    aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
                    aria-expanded={open}
                    aria-controls="wera-mobile-nav"
                >
                    <span />
                    <span />
                    <span />
                </button>
            </header>

            {/* Mobile drawer + backdrop */}
            <div
                className={`wera-backdrop${open ? ' is-open' : ''}`}
                onClick={close}
                aria-hidden="true"
            />

            <nav
                id="wera-mobile-nav"
                className={`wera-drawer${open ? ' is-open' : ''}`}
                aria-label="Mobile"
                aria-hidden={!open}
            >
                <div className="wera-drawer__head">
                    <span className="wera-drawer__brand">wera</span>
                    <button
                        type="button"
                        className="wera-drawer__close"
                        onClick={close}
                        aria-label="Fermer"
                    >
                        ✕
                    </button>
                </div>

                {user && (
                    <div className="wera-drawer__user">
                        <div className="wera-drawer__avatar">
                            {user.username?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div>
                            <p className="wera-drawer__hello">Salut,</p>
                            <p className="wera-drawer__name">{user.username}</p>
                        </div>
                    </div>
                )}

                <ul className="wera-drawer__list">
                    {!user && (
                        <>
                            <li>
                                <Link className="wera-drawer__link" to="/login" onClick={close}>
                                    Se connecter
                                </Link>
                            </li>
                            <li>
                                <Link className="wera-drawer__link wera-drawer__link--primary" to="/register" onClick={close}>
                                    Nouveau compte
                                </Link>
                            </li>
                        </>
                    )}
                    <li>
                        <Link className="wera-drawer__link" to="/about" onClick={close}>
                            À propos
                        </Link>
                    </li>
                    <li>
                        <Link className="wera-drawer__link" to="/contact" onClick={close}>
                            Contact
                        </Link>
                    </li>
                    {user && (
                        <li>
                            <button className="wera-drawer__link wera-drawer__link--danger" onClick={handleLogout}>
                                Déconnexion
                            </button>
                        </li>
                    )}
                </ul>

                <p className="wera-drawer__foot">Wera 🇲🇬 — fait à Madagascar</p>
            </nav>
        </>
    );
}
