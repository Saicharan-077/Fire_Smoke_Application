export const animations = {
  animation: {
    float: 'float 6s ease-in-out infinite',
    shimmer: 'shimmer 2s linear infinite',
    gradient: 'gradient 8s ease infinite',
    'pulse-glow': 'pulse-glow 3s ease-in-out infinite',
    'fade-up': 'fadeUp 0.5s ease-out forwards',
    'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1) forwards',
    'scale-in': 'scaleIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
  },
  keyframes: {
    float: {
      '0%, 100%': { transform: 'translateY(0px)' },
      '50%': { transform: 'translateY(-20px)' },
    },
    shimmer: {
      '0%': { backgroundPosition: '-200% 0' },
      '100%': { backgroundPosition: '200% 0' },
    },
    gradient: {
      '0%, 100%': { backgroundPosition: '0% 50%' },
      '50%': { backgroundPosition: '100% 50%' },
    },
    'pulse-glow': {
      '0%, 100%': { opacity: '0.4', transform: 'scale(1)' },
      '50%': { opacity: '0.8', transform: 'scale(1.05)' },
    },
    fadeUp: {
      '0%': { opacity: '0', transform: 'translateY(20px)' },
      '100%': { opacity: '1', transform: 'translateY(0)' },
    },
    slideUp: {
      '0%': { opacity: '0', transform: 'translateY(10px)' },
      '100%': { opacity: '1', transform: 'translateY(0)' },
    },
    scaleIn: {
      '0%': { opacity: '0', transform: 'scale(0.95)' },
      '100%': { opacity: '1', transform: 'scale(1)' },
    },
  },
};
