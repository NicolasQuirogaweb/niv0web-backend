# Diseño: venta de beats con licencias + About me con discografía

## Intención (el porqué)
Nicolás quiere **llevar niv0 a otro nivel**: que el sitio deje de ser solo un catálogo para escuchar y pase a ser **su tienda de beats** y **su carta de presentación como productor**.
- **Vender:** cualquier beat del catálogo se compra con licencia, pagando con Mercado Pago (Argentina) o PayPal (exterior). El comprador recibe los archivos sin que Nicolás intervenga.
- **Presentarse:** una página "About me" pública con su historia y su discografía, que además empuje tráfico y reproducciones a su Spotify.
- **Los sample packs** siguen libres y gratis: son su aporte a la comunidad.

## Metas
1. **Ningún beat de los catálogos se descarga gratis.** En beats solo se escucha.
2. **Cada beat se puede comprar** con tres licencias de precio fijo, iguales para todos los beats. **Todas entregan WAV.**

   | Licencia | ARS | USD (PayPal) | Entrega | Efecto |
   |---|---|---|---|---|
   | Común (no exclusiva) | 25.000 | a definir por Nicolás | WAV | La compra cualquiera, muchas veces |
   | Exclusiva | 80.000 | a definir | WAV | El beat queda **vendido** |
   | Exclusiva + stems | 200.000 | a definir | WAV + stems (ZIP) | El beat queda **vendido** |

3. **Licencia común, modelo estándar:** sigue valiendo aunque después se venda la exclusiva, con límites (tope de streams o ventas) que Nicolás define en el texto. Quien compra la exclusiva es avisado de que puede haber comunes previas. Desde la exclusiva nadie más puede comprar el beat en ninguna licencia.
4. **Pago:** Mercado Pago Checkout Pro (ARS) y PayPal (USD). La confirmación es **automática por webhook**.
5. **Entrega:**
   - **Mail** al comprador con los links de descarga, enviado desde un **dominio propio** que Nicolás compra (ej. `niv0prod.com`).
   - Página **"Mis compras"** atada a su cuenta de Google, para descargar cuando quiera.
   - Solo descarga quien pagó.
6. **About me** público (sin login): historia de Nicolás + discografía en **grilla de vinilos**. Al pasar o tocar una tapa, el disco sale de la funda y se abre el **reproductor embebido de Spotify** del álbum, para que las escuchas cuenten en Spotify.
7. **Discografía automática** desde su perfil de artista de Spotify, **solo sus lanzamientos** (álbumes, EPs, singles), sin carga manual.

## No-metas
- Carrito con varios beats: es un beat y una licencia por compra.
- Cupones, suscripciones, facturación fiscal.
- Precios distintos por beat.
- Vender loops o sample packs.
- Créditos de producción en temas de otros.
- Tienda para terceros.

## Anti-metas
- Que alguien consiga el **WAV o los stems** sin pagar: links públicos, URLs en la API o descargas sin chequear la compra.
- Que una compra quede cobrada y no entregada.
- Que dos personas compren la misma exclusiva.
- Que el comprador dependa de que Nicolás le mande algo a mano.
- Romper lo que ya anda: el reproductor, la pantalla bloqueada, los sample packs gratis, el login.

## Restricciones
- **Backend:** Express + MongoDB en Render Free (Docker, 512 MB). B2 con bucket **público**. Ya existen los links firmados (`getDownloadLink`), el bloqueo de WAV de beats (`isLicensedOriginal`) y los previews MP3 (`previewService`).
- **Frontend:** React + Vite en Vercel. Login con Google con cookies httpOnly. i18n ES/EN obligatorio.
- **Archivos hoy:** 79 beats tienen solo MP3; 11 tienen WAV (público) + preview MP3. Ningún beat tiene stems.
- Seguir la práctica de los repos: ADR, README, `CLAUDE.md`, CHANGELOG, tests, PRs.

## Decisiones de Nicolás
- Botón "Comprar" → elegir licencia → pagar → mail + descarga en el sitio, solo si pagó.
- Tres licencias, todas con WAV, con los precios en ARS de arriba.
- Mercado Pago y PayPal.
- La común no deja el beat vendido; la exclusiva sí. La común sigue valiendo con límites.
- About me y discografía públicos. Discografía automática con el reproductor de Spotify, solo sus lanzamientos, en grilla de vinilos.
- Ningún beat se descarga gratis.
- Comprar un dominio para los mails.

## Decisiones mías (Nicolás puede objetarlas)
- **Lo que se escucha** sigue siendo el MP3 público (o el preview de los WAV). Lo que se vende es el **WAV, que vive en un bucket privado nuevo** (`niv0-private`) junto con los stems. Se entrega con links firmados de pocos minutos, solo con una compra pagada.
- **Los 11 WAV actuales** se copian al bucket privado. Recién después de verificar la copia se **borran del bucket público** (se pide OK antes de borrar).
- **"Comprar" aparece solo en beats con WAV cargado.** Los beats que hoy solo tienen MP3 muestran "Consultar" (link de contacto) hasta que Nicolás suba su WAV desde el admin. "Exclusiva + stems" aparece solo si el beat tiene stems.
- **Admin:**
  - Por cada beat, subir el WAV y el ZIP de stems. Van directo a B2 con URL firmada, sin pasar por Render, por el tamaño.
  - Editar los precios (ARS/USD).
  - Ver las órdenes.
  - Ver y desmarcar vendidos.
- **Login para comprar:** obligatorio, igual que para los catálogos. "Mis compras" se arma con la cuenta.
- **Mercado Pago Checkout Pro y PayPal Orders v2:**
  - La orden se crea `pending`.
  - El webhook verifica el pago contra la API del proveedor y la marca `paid`, y eso dispara la entrega.
  - La página de vuelta consulta el estado.
- **Exclusivas sin doble venta:**
  - Al crear la orden, el beat queda **reservado 30 minutos** (operación atómica). Si se paga, queda vendido; si no, se libera.
  - En exclusivas, Mercado Pago **solo ofrece medios instantáneos** (sin Rapipago ni Pago Fácil), para que la reserva alcance.
  - Si igual llegan a cobrarse dos, la segunda se marca para reembolso manual y se le avisa a Nicolás.
- **Jobs** (reconciliar órdenes pendientes si se perdió un webhook, refrescar Spotify cada 6 h): endpoints protegidos con token, llamados por un cron de GitHub Actions, como el `keep-warm` que ya existe. No dependen del tráfico de Render Free.
- **Mail con Resend** desde el dominio propio: al comprador con los links, y a Nicolás con un aviso de cada venta.
- **Spotify Web API** (Client Credentials): trae los álbumes, EPs y singles del artista, los cachea en Mongo y el front embebe `open.spotify.com/embed/album/{id}`.
- **Historia:** la escribe Nicolás. Va en los archivos de idioma (ES/EN) con una foto suya.
- **Términos de cada licencia:** página con el texto que escribe Nicolás (conviene revisión legal). Hay que aceptarlos para comprar.
- **Etapas, cada una a producción por separado:**
  1. About me + discografía Spotify + sacar la descarga de beats. Es lo único que no necesita dominio ni cuentas de pago.
  2. Ventas con Mercado Pago de punta a punta: bucket privado, órdenes, webhook, mail, "Mis compras", admin de archivos y precios, vendidos, términos.
  3. PayPal.

## Lo que queda para el builder
- Modelos y endpoints, SDKs concretos, la animación de los vinilos, CSS, estados de carga y error.
- Detalle de la reconciliación y los reintentos de mail.
- Tests: unitarios con los proveedores mockeados y pruebas en los sandbox de Mercado Pago y PayPal antes de producción.

## Lo que necesita conseguir Nicolás (por etapa)
- **Etapa 1:** app en developer.spotify.com (client id/secret), el link de su perfil de artista, su historia (ES/EN) y una foto.
- **Etapa 2:**
  - Dominio.
  - Cuenta de Resend.
  - Cuenta de vendedor de Mercado Pago con credenciales de prueba y producción.
  - Texto de las licencias, con los límites de la común.
  - Los WAV (y stems) de los beats que quiera vender.
- **Etapa 3:** cuenta Business de PayPal y app de developer (sandbox y producción), y los precios en USD.
