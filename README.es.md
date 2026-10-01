# niv0web API (resumen en español)

Backend de **niv0 prod**, el sitio donde publico mis beats, loops y sample packs. Cualquiera con cuenta de Google puede escuchar y descargar. El catálogo lo administro desde un panel admin, y los audios están en Backblaze B2.

La documentación completa está en inglés en [README.md](README.md). Acá va lo mínimo para arrancar.

## Stack

Node 22, Express, MongoDB (Mongoose), Backblaze B2, login con Google, y JWT en cookies httpOnly. Se deploya con Docker en Render.

## Correrlo en local

```bash
cp .env.example .env        # completar Mongo, B2 y Google
npm install
npm run dev                 # http://localhost:5000
npm test                    # no necesita base ni B2
```

Para hacerte admin: logueate una vez desde el front y corré `npm run migrate -- tu@gmail.com`.

## Dónde mirar

- Endpoints y variables de entorno: [README.md](README.md#api)
- Cómo está armado: [docs/architecture.md](docs/architecture.md)
- Por qué se tomó cada decisión: [docs/decisions/](docs/decisions)
- Instrucciones para agentes de IA (Claude Code): [CLAUDE.md](CLAUDE.md)
