# KineticHost — 100% Free Minecraft & VPS Hosting Platform

[![Repository](https://img.shields.io/badge/GitHub-xAyan55%2Fkinetic-181717?style=for-the-badge&logo=github)](https://github.com/xAyan55/kinetic)
[![License](https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge)](LICENSE)
[![Status](https://img.shields.io/badge/Status-100%25%20Operational-22c55e?style=for-the-badge)](#)

**KineticHost** is a high-performance, 100% free Minecraft server hosting and Linux KVM VPS cloud compute platform. Powered by high-frequency CPUs, DDR5 ECC RAM, NVMe Gen 4 storage, and an intuitive web management control panel with zero hidden fees.

---

## ✨ Features

- 🎮 **100% Free Minecraft Server Hosting**: Paper, Purpur, Forge, and Fabric support with unmetered player slots.
- 🖥️ **Free KVM Cloud VPS Compute**: Full root SSH access and Linux OS distributions (Ubuntu, Debian, CentOS).
- 🔌 **One-Click Bedrock Crossplay**: Native Geyser and Floodgate integration for cross-platform play.
- 📦 **Modpack Installer**: Instant 1-click installation from CurseForge, Modrinth, FTB, and Technic.
- 🛡️ **Hardware DDoS Protection**: Inline hardware filtering to mitigate volumetric layer-3/4 attacks.
- ⚡ **Real-Time Control Panel**: Browser-based live console, file editor, sub-user permissions, and power actions.

---

## 🛠️ Local Setup & Development

1. **Clone the repository**:
   ```bash
   git clone https://github.com/xAyan55/kinetic.git
   cd kinetic
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Build Tailwind CSS**:
   ```bash
   npx tailwindcss -i css/tailwind.css -o css/tailwind-build.css --minify
   ```

4. **Serve locally**:
   ```bash
   python -m http.server 3000
   # or using Node
   npx serve -l 3000 .
   ```

---

## 🚀 Production VPS Deployment (PM2)

To deploy KineticHost on a production Linux VPS with PM2 on port 3000:

```bash
# 1. Clone repository into production directory
mkdir -p /var/www/kinetic
cd /var/www/kinetic
git clone https://github.com/xAyan55/kinetic.git .

# 2. Install PM2 and serve globally
npm install -g pm2 serve

# 3. Start process with PM2 on port 3000
pm2 start "serve -l 3000 ." --name "kinetic"

# 4. Save PM2 configuration and enable startup
pm2 save
pm2 startup
```

---

## 📄 Repository Information

- **GitHub Repository**: [https://github.com/xAyan55/kinetic](https://github.com/xAyan55/kinetic)
- **License**: MIT