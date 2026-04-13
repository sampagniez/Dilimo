# Utiliser l'image Debian légère avec Node.js
FROM node:20-bullseye-slim

# Mise à jour et installation de Python 3 et venv
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# Création de l'environnement virtuel et ajout au PATH
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances Node.js et Python
COPY package*.json ./
COPY requirements.txt ./

# Installer les dépendances
RUN npm install --production
RUN pip install --no-cache-dir -r requirements.txt

# Copier le reste de l'application
COPY . .

# Exposer le port du serveur
ENV PORT=3000
EXPOSE $PORT

# Extraire les données DVF
RUN if [ -f data/dvf.zip ]; then cd data && unzip dvf.zip && rm dvf.zip; fi

# Démarrer le serveur
CMD ["npm", "start"]
