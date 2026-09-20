import fs from "node:fs";
const dir = "exports/greensynk";
const leaf = `<path d="M20 7C20 7 10 15 10 25C10 30.5 14.5 35 20 35C25.5 35 30 30.5 30 25C30 15 20 7 20 7Z" fill="white"/><path d="M20 17V35" stroke="#059669" stroke-width="2.5" stroke-linecap="round"/><path d="M20 23C20 23 14 20 11 16M20 28C20 28 26 25 29 21" stroke="#059669" stroke-width="2" stroke-linecap="round"/>`;
const svg = (w,h,content)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${content}</svg>`;
fs.writeFileSync(`${dir}/app-icon.svg`,svg(1024,1024,`<path fill="#059669" d="M0 0H1024V1024H0Z"/><g transform="translate(72 50) scale(22)">${leaf}</g>`));
fs.writeFileSync(`${dir}/splash-logo.svg`,svg(1200,600,`<g transform="translate(440 0) scale(8)">${leaf}</g><text x="600" y="450" text-anchor="middle" font-family="DejaVu Sans" font-size="100" font-weight="bold" fill="white" letter-spacing="-3">GreenSynk</text>`));
fs.writeFileSync(`${dir}/splash-screen.svg`,svg(1290,2796,`<path fill="#059669" d="M0 0H1290V2796H0Z"/><g transform="translate(485 1098) scale(8)">${leaf}</g><text x="645" y="1548" text-anchor="middle" font-family="DejaVu Sans" font-size="100" font-weight="bold" fill="white" letter-spacing="-3">GreenSynk</text>`));
const colors = [
 ["Brand / splash background","#059669"],
 ["Primary button / pressed green","#047857"],
 ["Light background","#F9FAFB"],
 ["Card / on-primary text","#FFFFFF"],
 ["Primary text","#0F172A"],
 ["Secondary text","#64748B"],
 ["Borders","#E2E8F0"],
 ["Soft green surface","#ECFDF5"],
 ["Error","#DC2626"],
];
fs.writeFileSync(`${dir}/theme-colors.json`,JSON.stringify(Object.fromEntries(colors),null,2));
fs.writeFileSync(`${dir}/theme-colors.svg`,svg(1200,1420,`<path fill="#F9FAFB" d="M0 0H1200V1420H0Z"/><text x="80" y="110" font-family="DejaVu Sans" font-size="48" font-weight="bold" fill="#0F172A">GreenSynk</text><text x="80" y="165" font-family="DejaVu Sans" font-size="24" fill="#64748B">Mobile theme · Emerald leaf</text>${colors.map(([label,hex],i)=>`<rect x="80" y="${220+i*125}" width="140" height="90" rx="14" fill="${hex}" stroke="#E2E8F0"/><text x="255" y="${258+i*125}" font-family="DejaVu Sans" font-size="27" fill="#0F172A">${label}</text><text x="255" y="${292+i*125}" font-family="DejaVu Sans Mono" font-size="23" fill="#64748B">${hex}</text>`).join("")}`));