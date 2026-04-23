// Local dev can still hit your LAN server, but production must use the deployed backend.
const LOCAL_HOST = '192.168.88.26';
const LOCAL_API = `https://${LOCAL_HOST}:3001/api`;
const LOCAL_SOCKET = `https://${LOCAL_HOST}:3001`;

const PROD_BACKEND_ORIGIN = 'https://wera-backend.onrender.com';

export const API_URL = import.meta.env.PROD ? `${PROD_BACKEND_ORIGIN}/api` : LOCAL_API;
export const SOCKET_URL = import.meta.env.PROD ? PROD_BACKEND_ORIGIN : LOCAL_SOCKET;
