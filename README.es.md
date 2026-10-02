# niv0web API (resumen en español)

Backend de **niv0 prod**, el sitio donde publico mis beats, loops y sample packs. Cualquiera con cuenta de Google puede escuchar y descargar. El catálogo lo administro desde un panel admin, y los audios están en Backblaze B2.

Hice niv0 para que, cuando alguien me pregunta "¿tenés beats para usar?", la respuesta sea un solo link. El artista entra, escucha todo mi catálogo de beats, loops y sample packs, y descarga lo que necesita sin esperar a que le mande archivos uno por uno. También fue la excusa para hacer mi propia app de música y tener control total sobre cómo se muestra mi trabajo.

En funcionalidad cumple lo que busco: un catálogo interactivo y un puente para contactarme. La interfaz todavía va cambiando mientras encuentro la estética que va.

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

## Cómo trabajo con IA

Uso la IA para ir más rápido, no para dejar de pensar. Leo lo que pido y lo que recibo, y reviso cada cambio antes de que entre. Es una herramienta muy potente, y por eso mismo la sigo estudiando y sigo las prácticas que sacan lo mejor de ella. La configuración de este repo es parte de eso.
