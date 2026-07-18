/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        yape: {
          light: '#9C27B0',
          DEFAULT: '#740099',
          dark: '#4A0066',
        }
      }
    },
  },
  plugins: [],
}
