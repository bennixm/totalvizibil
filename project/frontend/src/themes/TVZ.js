import { definePreset } from '@primeuix/themes'

const TVZ = definePreset({
    primitive: {
        borderRadius: '8px',
        fontFamily: 'Inter, system-ui, sans-serif'
    },
    semantic: {

        primary: {
            50:  '#f5f7ff',
            100: '#e6ebff',
            200: '#cdd6ff',
            300: '#aab8ff',
            400: '#8093ff',
            500: '#5c6cff',
            600: '#4655e6',
            700: '#3844cc',
            800: '#2f3aa3',
            900: '#2a3480'
        },


        surface: {
            0:   '#ffffff',  // main background
            50:  '#ffffff',
            100: '#fcfcfd',
            200: '#f8fafc',
            300: '#f1f5f9'
        },

        text: {
            color: '#2631a1',
            secondaryColor: '#6b7280'
        },

        border: {
            color: '#e5e7eb'
        },

        success: { 500: '#22c55e' },
        warning: { 500: '#f59e0b' },
        danger:  { 500: '#ef4444' }
    }
})

export default TVZ