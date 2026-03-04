import { SYNTH_THEME } from '../../shared/theme/SynthTheme';

/**
 * Canvas UI adapter over the shared synth theme tokens.
 */
export const UITheme = {
    colors: {
        primary: SYNTH_THEME.colors.primary,
        primaryHover: SYNTH_THEME.colors.primaryHover,
        secondary: SYNTH_THEME.colors.secondary,
        secondaryHover: SYNTH_THEME.colors.secondaryHover,
        accent: SYNTH_THEME.colors.accent,
        danger: SYNTH_THEME.colors.danger,
        dangerHover: SYNTH_THEME.colors.dangerHover,
        background: SYNTH_THEME.colors.background,
        panelBg: SYNTH_THEME.colors.panel,
        panelBgHover: SYNTH_THEME.colors.panelHover,
        text: SYNTH_THEME.colors.text,
        textMuted: SYNTH_THEME.colors.textDim,
        border: SYNTH_THEME.colors.secondary,
        borderActive: SYNTH_THEME.colors.primary
    },
    typography: SYNTH_THEME.typography,
    styling: {
        borderWidth: SYNTH_THEME.styling.borderWidth,
        cornerRadius: SYNTH_THEME.styling.cornerRadius
    }
};

/**
 * Returns a completed Canvas font string based on the theme specs.
 */
export function getFont(size: number, weight: 'normal' | 'bold' | 'italic' = 'normal'): string {
    return `${weight} ${size}px ${UITheme.typography.fontFamily}`;
}
