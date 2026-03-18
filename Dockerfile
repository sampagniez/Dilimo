# Utiliser l'image Debian légère avec Node.js
FROM node:20-bullseye-slim

# Mise à jour et installation de Python 3 et pip
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances Node.js et Python
COPY package*.json ./
COPY requirements.txt ./

# Installer les dépendances
RUN npm install --production
RUN pip3 install --no-cache-dir -r requirements.txt --break-system-packages

# Copier le reste de l'application (en ignorant les fichiers dans .dockerignore)
COPY . .

# Exposer le port du serveur (Défini par la variable PORT, par défaut 3000)
ENV PORT=3000
EXPOSE $PORT

# Démarrer le serveur
CMD ["npm", "start"]
