const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000";

export async function getMessage(): Promise<string> {
    const res = await fetch(`${API_URL}/`);
    return res.text();
}
