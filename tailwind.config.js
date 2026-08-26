/** @type {import('tailwindcss').Config} */
module.exports = {
	prefix: 'tw-',
	important: false,
	content: [
		"./index.html",
		"./index.js",
		"./dashboard.html",
		"./admin.html",
		"./auth/**/*.html",
		"./auth/**/*.js",
		"./js/**/*.js"
	],
	theme: {
		extend: {
			colors: {
				primary: "#FFFFFF",
				'kh-black': "#050505",
				'kh-dark': "#0A0A0A",
				'kh-surface': "#101010",
				'kh-elevated': "#151515",
				'kh-border': "rgba(255,255,255,0.08)",
				'kh-muted': "#666666",
				'kh-secondary': "#A1A1A1",
			}
		},
	},
	plugins: [],
}
