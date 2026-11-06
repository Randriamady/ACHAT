

**1. Ouvrir le bon dossier**

Dans VS Code, ouvrez toujours :

```text
D:\Achat\achat-locaux
```

```bash
cd /d/Achat/achat-locaux
```

**2. Vérifier les prérequis**

Installez et vérifiez :

```bash
node --version
npm --version
```

PostgreSQL doit également être installé et démarré.

**3. Configurer le backend**

Allez dans le backend :

```bash
cd /d/Achat/achat-locaux/backend
```



```env
DATABASE_URL=postgres://postgres:VOTRE_MOT_DE_PASSE@localhost:5432/achat

AUTH_IDENTIFIER=admin
AUTH_PASSWORD=admin123
AUTH_NAME=Administrateur
AUTH_SECRET=une_cle_secrete_longue

PORT=8000
CORS_ORIGINS=*
NODE_ENV=development
```

Ne mettez pas d’espace autour du signe `=`.

**4. Créer la base PostgreSQL**

Dans pgAdmin, créez une base nommée :

```text
achat
```

Ou avec un client PostgreSQL :

```sql
CREATE DATABASE achat;
```

La base doit exister avant d’exécuter les migrations ou le seed.

**5. Installer les dépendances backend**

Depuis `backend` :

```bash
npm install
```

Cette commande installe notamment :

- Express
- PostgreSQL `pg`
- `node-pg-migrate`
- dotenv
- CORS

**6. Appliquer les migrations existantes**

Toujours depuis `backend` :

```bash
npm run migrate:up
```


Les migrations sont dans :

```text
backend/migrations
```

Elles créent notamment les tables `achats` et `users`.

**7. Créer l’utilisateur administrateur**

Après les migrations :

```bash
node db/seed-admin.js
```

Résultat attendu :

```text
Utilisateur admin créé : admin
```


```text
Identifiant : admin
Mot de passe : admin123
```

**8. Démarrer le backend**

```bash
npm start
```

Résultat attendu :

```text
Serveur lancé sur http://localhost:8000
```


```bash
npm --prefix D:\Achat\achat-locaux\backend start
```

**9. Démarrer le frontend**

Ouvrez un deuxième terminal :

```bash
cd /d/Achat/achat-locaux/frontend
npm install
npm run dev
```

Le frontend sera disponible sur :

```text
http://localhost:3000
```


**Ordre complet à retenir**

Pour une première installation :

```bash
cd /d/Achat/achat-locaux/backend
npm install
npm run migrate:up
node db/seed-admin.js
npm start
```

Dans un deuxième terminal :

```bash
cd /d/Achat/achat-locaux/frontend
npm install
npm run dev
```

