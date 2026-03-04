export const SYNTH_THEME = {
    colors: {
        primary: '#00ffff',
        primaryHover: '#00cccc',
        secondary: '#ff00ff',
        secondaryHover: '#cc00cc',
        accent: '#ffaa00',
        danger: '#ef4444',
        dangerHover: '#dc2626',
        background: '#0a041c',
        panel: 'rgba(10, 4, 28, 0.85)',
        panelHover: 'rgba(20, 10, 50, 0.95)',
        text: '#f8fafc',
        textMuted: '#cbd5e1',
        textDim: '#64748b',
        border: 'rgba(255, 0, 255, 0.28)',
        borderStrong: 'rgba(0, 255, 255, 0.34)',
        success: '#00ff64'
    },
    typography: {
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        sizes: {
            title: 54,
            header: 42,
            body: 28,
            small: 20
        }
    },
    styling: {
        borderWidth: 2,
        cornerRadius: 12,
        glowPrimary: '0 0 10px rgba(0, 255, 255, 0.5), 0 0 20px rgba(0, 255, 255, 0.3)',
        glowSecondary: '0 0 10px rgba(255, 0, 255, 0.5), 0 0 20px rgba(255, 0, 255, 0.3)'
    }
} as const;
