# Module Music

## Lancer le dashboard

```sh
cd /var/home/E256190S/reseau/Perso/Bureau/DASBOARD/Dashboard
python -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
uvicorn backend.main:app --host 127.0.0.1 --port 8000 --reload
```

Ouvre ensuite `http://127.0.0.1:8000`.

N'ouvre pas `index.html` directement en `file://` : les modules HTML et les routes YouTube Music doivent passer par un serveur local.

## Cookies YouTube Music

1. Ouvre `https://music.youtube.com` dans le navigateur du compte à lier.
2. Ouvre la console.
3. Colle le contenu de `youtube-music-cookie-helper.js`.
4. Colle le JSON copié dans le module Music du dashboard.

Chaque compte dashboard stocke ses propres cookies YouTube Music dans la base SQLite locale `backend/dashboard.sqlite3`.
