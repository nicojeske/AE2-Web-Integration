export function setCookie(name: string, value: string, days: number): void {
    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${name}=${value};expires=${expires};path=/`;
}

export function getCookie(name: string): string | null {
    const target = `${name}=`;
    for (const part of document.cookie.split(";")) {
        const trimmed = part.trimStart();
        if (trimmed.startsWith(target)) return trimmed.slice(target.length);
    }
    return null;
}
