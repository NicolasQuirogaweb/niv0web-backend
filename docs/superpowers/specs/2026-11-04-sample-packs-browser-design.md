# Diseño: sample packs de verdad, con explorador estilo FL Studio

## Intención (el porqué)
Hoy la página "Sample packs" muestra cinco "packs" (Fxs, 808, Synths, Drums, Bass), pero en realidad son **las carpetas de un solo pack**. Un sample pack es la suma de todo eso. Nicolás quiere corregir el concepto y que el sitio se sienta como su DAW:
- La página **Sample packs** pasa a ser una vitrina con un pack por tarjeta, porque van a venir más.
- Al abrir un pack aparece un **explorador estilo FL Studio** (el panel "Browser" del costado). Las carpetas se despliegan y cada sample suena con un clic.
- El pack se **descarga entero en un ZIP**. Los samples sueltos solo se escuchan: "si bajás el pack, bajás el pack".
- Va a haber packs **gratis** y packs **pagos**. El primero, **Mastermind**, es gratis.

## Metas
1. **Un pack** tiene nombre, descripción, tapa, carpetas ordenadas y samples dentro de cada carpeta. Además es gratis o tiene precio.
2. **Mastermind** reúne los 247 samples de hoy (≈143 MB de WAV ya en B2) en cinco carpetas, sin volver a subir ningún audio.
3. **Vitrina** `/samplepacks`: tarjeta por pack con tapa, nombre, etiqueta "Gratis" o precio, y cantidad de carpetas y samples.
4. **Página del pack:**
   - Arriba: tapa, nombre, descripción y botón **Descargar ZIP** con el peso.
   - Abajo: el explorador.
5. **Explorador:**
   - Carpetas que se abren y cierran.
   - Cada sample es una línea con ícono y duración. Un clic lo hace sonar y lo marca.
   - Suena un solo sample a la vez y no pasa solo al siguiente.
   - Arriba del árbol se ve el sample que suena y su avance.
   - No hay botón de descarga por sample.
6. **Admin:**
   - Crear y editar packs: nombre, descripción, tapa, carpetas (agregar, renombrar, ordenar, borrar vacías), gratis o con precio.
   - Subir samples a una carpeta y moverlos de carpeta.
   - Un botón **Armar ZIP** que muestra el estado.
7. **Tapa provisoria:** Mastermind todavía no tiene tapa. Mientras falte, se muestra una tapa generada con el nombre del pack. Cuando Nicolás suba la real, la reemplaza desde el admin.

## No-metas
- **Cobrar packs.** El campo de precio existe y la tarjeta lo muestra, pero en un pack pago el botón dice "Próximamente" hasta la etapa 2 de la tienda (Mercado Pago), descrita en `2026-11-03-store-and-about-design.md`. Ahí se suma la compra de packs como un producto más.
- Subcarpetas dentro de carpetas: un solo nivel por ahora.
- Arrastrar samples entre carpetas, búsqueda dentro del pack, favoritos.
- Previews cortas en MP3 para los packs pagos. Queda como mejora futura si Nicolás lo pide.

## Anti-metas
- **Perder samples o romper sus URLs** en la migración.
- Que se pueda **bajar un sample suelto** desde la interfaz.
- Que la descarga del ZIP **pase por Render**: el ZIP se sirve desde B2, como dice el ADR 0004.
- Que armar el ZIP **tumbe el backend**, que corre en Render Free con 512 MB. El ZIP pesa unos 143 MB y no puede quedar entero en memoria.
- Que un ZIP **viejo** se siga ofreciendo como actual después de cambiar samples sin avisarle al admin.
- Romper lo que ya anda: los beats, los loops, el reproductor, el login y el admin de los otros catálogos.

## Restricciones
- **Backend:** Express + MongoDB + B2, en Render Free (Docker, 512 MB). Los modelos actuales son `SamplePack` (title, description, imageUrl, type) y `Samples` (title, description, audioFile, samplepackId).
- **Frontend:** React + Vite, i18n ES/EN obligatorio. Hay que seguir las reglas de `CLAUDE.md`:
  - acento ámbar;
  - Orbitron para la interfaz e Inter para la lectura (ADR 0006);
  - `PageBackground` con su video de sección.
- **Acceso:** el mismo que hoy. Los catálogos requieren login, y el ZIP también.
- **Práctica de los repos:** ADR, README, `CLAUDE.md`, CHANGELOG, tests y PRs. Cada rama sale de `main`.
- **Datos:** la base local apunta a la misma base que producción, así que la migración se trata como una operación en producción.

## Decisiones de Nicolás
- La página es una vitrina de packs, porque va a haber más.
- Hay packs gratis y pagos. Mastermind es gratis.
- Se descarga solo el ZIP del pack entero. Los samples se escuchan y no se bajan sueltos.
- El explorador va al estilo del panel del FL Studio.
- El primer pack se llama **Mastermind**. La tapa llega más adelante.

## Decisiones mías (Nicolás puede objetarlas)
- **Modelo de datos:**
  - **`SamplePack`** suma:
    - `slug`;
    - `folders`: una lista ordenada de nombres;
    - `price` en ARS y USD, null si es gratis;
    - `zip`: url, bytes, fecha en que se armó y si quedó **desactualizado**.
  - `imageUrl` pasa a ser opcional.
  - `published` (true/false): solo los packs publicados aparecen en la vitrina y en la API pública. Un pack nuevo nace sin publicar; el admin lo publica cuando tiene samples.
  - **`Samples`** suma `folder`, que tiene que ser una de las carpetas del pack.
- **Packs pagos hasta la etapa 2:** el admin puede cargar precio, pero **un pack con precio no se puede publicar** hasta que exista la compra. Así no queda ningún WAV de un pack pago escuchable ni descargable. En la etapa 2 se decide cómo se escuchan (por ejemplo, previews en MP3) y el ZIP va al bucket privado.
- **Precio:** ARS obligatorio y USD opcional (llega con PayPal en la etapa 3). La tarjeta muestra ARS en español y USD en inglés si existe; si no, ARS.
- **Sin descarga suelta tampoco por la API:** `isLicensedOriginal` (`utils/downloadSource.js`) también bloquea las claves `samples/`, igual que hoy con `beats/`. Los WAV siguen en el bucket público para poder escucharlos; esto cierra el camino del sitio, no el bucket.
- **Cuándo queda desactualizado el ZIP:** al agregar, borrar, mover o reemplazar un sample, y al renombrar el pack o una carpeta. El admin lo ve marcado y vuelve a armarlo. Mientras tanto, la descarga pública sigue ofreciendo el último ZIP armado.
- **Migración** con un script de una sola vez:
  - Corre en seco por defecto y muestra qué haría. Se puede correr dos veces sin duplicar nada.
  - Crea Mastermind con las carpetas en este orden: **Drums, 808, Bass, Synths, Fxs**.
  - Mueve cada sample a Mastermind, con `folder` igual al nombre del pack viejo.
  - Verifica los conteos (247 en total, y el número por carpeta).
  - Publica Mastermind y deja los cinco packs viejos **sin publicar**, así desaparecen de la vitrina aunque todavía no se borren.
  - **Borrar los cinco packs viejos es un paso aparte**, y se le pide el OK a Nicolás antes.
  - Las imágenes viejas (`img-sonido`) no se borran.
- **ZIP:**
  - Lo arma el backend como una tarea en segundo plano que se lanza desde el admin.
  - Baja cada WAV de B2 y lo mete en el ZIP sin comprimir: los WAV casi no se comprimen y así se ahorra CPU.
  - Sube el resultado a B2 **en streaming**, con carga por partes, sin tener el ZIP entero en memoria.
  - Adentro del ZIP hay una carpeta por carpeta del pack: `Mastermind/Drums/…`.
  - El archivo va al bucket público con un hash en el nombre y cache inmutable, como los fondos.
  - El admin consulta el estado: armando, listo o error.
  - Los packs pagos van a necesitar el ZIP en el bucket privado. Eso entra en la etapa 2.
- **API pública:**
  - `GET /api/resources/samplepacks` devuelve la vitrina, con conteos y precio. Para un pack pago no devuelve la URL del ZIP.
  - `GET /api/resources/samplepacks/:slug` devuelve el pack con sus carpetas y samples.
- **Rutas del front:**
  - El pack vive en `/samplepacks/:slug`.
  - La ruta vieja `/samples/samplepack/:id` redirige a la vitrina, para no dejar links rotos.
- **Explorador:**
  - Al entrar, solo está abierta la primera carpeta.
  - Es navegable con teclado y tiene la semántica de árbol de accesibilidad.
  - Usa el reproductor que ya existe (`usePlaylistPlayer` con `autoAdvance: false`).
  - Colores y forma: el gris oscuro del FL con el ámbar del sitio, como la maqueta que vio Nicolás: `2026-11-04-sample-packs-browser-mockup.html`, junto a este documento. Es una referencia de estilo; los tokens del sitio mandan.
  - En el celular se ve igual, a todo el ancho.
- **Duración de cada sample:** se lee de los metadatos del audio cuando carga la línea, sin descargar el archivo entero. Si no está disponible, la línea va sin duración.
- **La forma de onda real** queda como opcional. Solo se agrega si no obliga a bajar dos veces cada sample. Si no, se muestra una barra de avance.
- **Admin:** el formulario y la página de samples actuales se extienden; no se crea una pantalla nueva. Sí se suman el editor de carpetas, el selector de carpeta al subir y en cada sample, el campo de precio y el panel del ZIP.

## Lo que queda para el builder
- La librería para el ZIP en streaming (por ejemplo `archiver`) y cómo usar la carga por partes de B2 con la API que ya existe en `b2Service`.
- Dónde se guarda el estado de la tarea del ZIP. Tiene que sobrevivir a que se consulte desde otra request, y es aceptable perder una tarea en curso si Render reinicia; en ese caso se muestra como error y se reintenta.
- La forma exacta de la tapa provisoria, el CSS del explorador, y los estados de carga y error.
- Los tests: unitarios del modelo, de la API, de la migración (con base en memoria o mocks) y de los componentes del explorador.
- El orden de los PRs entre backend y frontend. El backend tiene que seguir sirviendo al front viejo hasta que salga el nuevo.

## Lo que necesita Nicolás
- Ahora, nada: el pack arranca con la tapa provisoria y una descripción mía que él puede cambiar desde el admin.
- Dar el OK antes de borrar los cinco packs viejos.
- Más adelante, la tapa real de Mastermind.
