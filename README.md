# Cuaderno de viajes

Organizador de viajes para mamá: un programa de Windows y la misma aplicación en el móvil (iPhone y Android), con los datos sincronizados en la nube.

Cada viaje tiene **portada, fechas y viajeros**, y estas secciones:

| Sección | Qué hace |
|---|---|
| **Resumen** | Cuenta atrás, lo próximo que toca, el tiempo previsto (hasta 16 días vista), mapa en miniatura y notas. |
| **Itinerario** | El viaje día a día: vuelos, entrada y salida del hotel, actividades, lugares asignados a cada día y planes propios con hora. |
| **Mapa** | Lugares por categorías, alojamientos, vuelos (con su curva real) y rutas. Buscador de sitios, «Añadir punto» tocando el mapa, filtro por día, «Cómo llegar» con Google Maps o Apple Maps y la ubicación actual. |
| **Reservas** | Vuelos (con buscador de aeropuertos), alojamientos, trenes, autobuses, barcos, coches de alquiler, entradas y restaurantes, con su código de reserva (se copia con un toque), precio y billetes adjuntos. |
| **Documentos** | Billetes, tarjetas de embarque, entradas, guías, seguros, fotos y enlaces. Todo se abre dentro de la app: visor de PDF propio (también en el móvil), enlaces de Google Drive, Docs, YouTube, Dropbox, pCloud, PDF y webs. Descarga, arrastrar y soltar, y copia para verlos sin conexión. |
| **Correos** | Busca en Gmail los correos del viaje (búsqueda preparada con el destino, las fechas y los códigos de las reservas) y los guarda en el viaje junto con sus adjuntos. |
| **Maleta** | Lista con plantillas (esencial, ropa, aseo, playa, frío, avión), grupos propios y copiar la maleta de otro viaje. |
| **Gastos** | Presupuesto, gastos por categorías, precios de las reservas sumados solos y cuentas entre viajeros. |

Además: 6 temas (claro y oscuro), tres tamaños de letra, funciona sin conexión con lo último que se cargó (los cambios se suben al volver la conexión y se combinan con los hechos en otro dispositivo), billetes disponibles sin internet, añadir las reservas al calendario del móvil (.ics), compartir un resumen por WhatsApp, imprimir o guardar en PDF, crear una reserva desde un correo, duplicar viajes y copias de seguridad.

---

## Puesta en marcha (una sola vez, unos 30 minutos)

### 1. La base de datos (Supabase, plan gratuito)

1. Crea una cuenta en [supabase.com](https://supabase.com) y un proyecto nuevo (elige una región de Europa). Apunta la contraseña de la base de datos aunque no la vayas a usar.
2. En el panel del proyecto abre **SQL Editor**, pega el contenido de [`backend/supabase.sql`](backend/supabase.sql) y pulsa **Run**. Crea las tablas, la seguridad (cada usuario solo ve lo suyo) y el espacio privado para los archivos.
3. **Authentication → Users → Add user → Create new user**: correo y contraseña de tu madre. Si aparece la opción de confirmar automáticamente el usuario, márcala.
4. En los ajustes de **Authentication**, desactiva **«Allow new users to sign up»** para que nadie más pueda crearse una cuenta.
5. Copia dos datos (están en el botón **Connect** de arriba y en **Settings → API Keys**):
   - la **URL del proyecto** (`https://xxxx.supabase.co`)
   - la **clave pública** (*publishable key*, o la *anon key* antigua). **Nunca** la *secret* / *service_role*.

### 2. GitHub (web para el móvil y programa de Windows)

1. En este repositorio: **Settings → Secrets and variables → Actions → pestaña Variables → New repository variable**:
   - `SUPABASE_URL` → la URL del proyecto
   - `SUPABASE_KEY` → la clave pública
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. **Actions →** ejecuta **«Web para el móvil»** y **«Programa de Windows»** (botón *Run workflow*). Tardan unos minutos.

Con eso la app ya sabe a qué base de datos conectarse y tu madre solo tendrá que poner su correo y contraseña.

### 3. En el ordenador de tu madre

1. Ve a **Releases** (columna derecha del repositorio) y descarga el `.exe` más reciente.
2. Ábrelo: se instala solo, sin preguntas, y se abre. Como el programa no está firmado digitalmente, Windows puede mostrar antes «Windows protegió su PC»: **Más información → Ejecutar de todas formas**.
3. Queda un acceso directo «Cuaderno de viajes» en el escritorio y en el menú Inicio. Entra con su correo y contraseña.

Para actualizar el programa en el futuro: descargar el `.exe` nuevo e instalarlo encima (los datos están en la nube, no se pierden).

### 4. En el móvil

La dirección es `https://<tu-usuario-en-minúsculas>.github.io/<repositorio>/` (en este caso `https://gonvegato.github.io/App-Mama/`). En el programa de escritorio, **Ajustes → Usarla en el móvil** muestra un código QR para abrirla con la cámara.

- **iPhone:** abrir en Safari → Compartir → **Añadir a pantalla de inicio**.
- **Android:** abrir en Chrome → menú ⋮ → **Añadir a pantalla de inicio** / **Instalar aplicación**.

### 5. Gmail (opcional, recomendado)

La conexión con Gmail se hace con un pequeño script de Google que se instala **en la cuenta de Gmail de tu madre** y solo puede **leer** (no envía ni borra nada):

1. Con su cuenta, entra en [script.google.com](https://script.google.com) → **Nuevo proyecto**.
2. Pega el contenido de [`backend/gmail-ayudante.gs`](backend/gmail-ayudante.gs) y cambia la línea `CLAVE` por una frase secreta.
3. Guarda, elige la función **probar** y pulsa **Ejecutar**. Acepta los permisos. Si sale «Google no ha verificado esta aplicación»: *Configuración avanzada → Ir a … (no seguro)*; es normal, el script es vuestro.
4. **Implementar → Nueva implementación** (*Deploy → New deployment*) → tipo **Aplicación web** (*Web app*). *Ejecutar como*: **Yo** (*Me*). *Quién tiene acceso*: **Cualquier usuario** (*Anyone*). Copia la URL que termina en `/exec`.
5. En la app: **Ajustes → Correo (Gmail)** → pega la URL y la clave → **Guardar y probar**. Se guarda en la nube, así que en el móvil ya funciona.

El ayudante también sirve para abrir **enlaces cortos** de Google Maps (`maps.app.goo.gl`) y Apple Maps (`maps.apple`) al importar, y para que los **enlaces guardados** (enlaces públicos de pCloud, PDF y webs que no se dejan mostrar dentro de otras apps) se abran dentro de la app en el móvil. En el programa de Windows no hace falta: ahí se abren dentro siempre.

### 6. Que la base de datos no se «duerma»

El plan gratuito de Supabase **pausa el proyecto tras 7 días sin uso**. El flujo **«Mantener activa la base de datos»** hace una consulta mínima cada 3 días (usa las mismas variables del paso 2).

Ojo: GitHub **desactiva las tareas programadas de un repositorio público tras 60 días sin actividad** en el repositorio. Si te llega un aviso, entra en *Actions → Mantener activa la base de datos → Enable workflow*. Si aun así el proyecto se pausara, se reactiva desde el panel de Supabase con *Restore project* (los datos no se pierden).

---

## Llevar el programa en un USB

Además del instalador, cada versión incluye **`Cuaderno-de-viajes-…-USB.zip`** (en *Actions* → la última ejecución → artefacto *Cuaderno-de-viajes-USB*, o en *Releases*).

1. Descomprime el `.zip` **directamente en la raíz del USB**. Quedan tres cosas: la carpeta `Cuaderno de viajes` (el programa), la carpeta `Archivos de viajes` y **`Abrir Cuaderno de viajes.bat`**.
2. En cualquier PC con Windows, abre `Abrir Cuaderno de viajes.bat` (o `Cuaderno de viajes\Cuaderno de viajes.exe`). No se instala nada en el ordenador.
3. Se entra con la misma cuenta de siempre: los viajes son los de la nube, igual que en el móvil.

Mientras el programa está abierto desde el USB, **copia solo y sin preguntar** todos los archivos de los viajes (los subidos y los guardados como enlace a PDF, fotos, Dropbox, pCloud o archivos de Google Drive) a `Archivos de viajes\<año-mes> <viaje>\`. A partir de ahí se abren desde el USB: más rápido y sin conexión. Si se cambia el nombre o la fecha del viaje, la carpeta se renombra; si se borra un documento, su copia también. Las webs normales no se copian (no son un archivo). El estado se ve en **Ajustes → Copia en el USB** y con el aviso de la barra lateral.

A tener en cuenta:

- **Solo Windows** (64 bits). Si el USB está en **exFAT o FAT32** (clic derecho en el USB → *Propiedades* → *Sistema de archivos*), mejor: esos formatos no guardan la marca de «descargado de Internet», así que el aviso «Windows protegió su PC» no sale al abrirlo en otros ordenadores. Si el USB es NTFS, antes de descomprimir: clic derecho en el `.zip` → *Propiedades* → marcar **Desbloquear**.
- El programa no está firmado digitalmente (para un particular en la UE no hay forma asequible). En los PC con **Control inteligente de aplicaciones** activado (*Seguridad de Windows → Control de aplicaciones y navegador*), Windows lo bloquea sin opción de abrirlo; ahí queda la versión web en el navegador. Algunos ordenadores de empresa o de biblioteca tampoco dejan abrir programas desde un USB.
- **Si un ordenador no deja abrir programas desde el USB:** copia solo `Cuaderno de viajes\\Cuaderno de viajes.exe` al Escritorio de ese PC y ábrelo con el USB enchufado. El programa detecta el USB y sigue guardando ahí la sesión y las copias de los archivos; en ese ordenador no queda nada. Al terminar, borra la copia del Escritorio. (No funciona apagar el Control inteligente de aplicaciones con un programa: Windows lo revierte y haría falta permiso de administrador.)
- Si algún día Microsoft Defender lo confunde con un virus (pasa a veces con programas sin firmar), lo pone en cuarentena y lo quita del USB; los viajes y archivos no se pierden. Basta con volver a descomprimir el `.zip` y, si se repite, enviar el archivo a Microsoft como falso positivo en [microsoft.com/wdsi/filesubmission](https://www.microsoft.com/en-us/wdsi/filesubmission). Guardad el `.zip` también fuera del USB.
- Mejor un USB **3.0** o superior: el programa ocupa unos 300 MB y en un USB lento tarda en arrancar.
- La nube sigue siendo el original. Las copias del USB son eso, copias: si se pierde el USB no se pierde nada, pero **quien lo encuentre puede ver los archivos y entrar en la cuenta** (la sesión queda guardada en el USB). Si se pierde: desde el móvil, **Ajustes → Cuenta → «Cerrar la sesión en todos los demás dispositivos»** y cambiad la contraseña. («Cerrar sesión» normal solo cierra la del dispositivo en el que se pulsa.)
- **Actualizar:** descomprime el `.zip` nuevo encima del anterior (sustituyendo archivos). No borres la carpeta `Cuaderno de viajes\Datos`, que guarda la sesión y la lista de copias (si se borra, solo hay que volver a entrar y los archivos se vuelven a copiar).
- Retira el USB con «Quitar hardware de forma segura» después de cerrar el programa, sobre todo si estaba copiando.

---

## Enlace del alojamiento (Booking, Airbnb…)

Al añadir o editar un **alojamiento** (y también actividades o restaurantes) hay un campo **«Enlace»**: pega ahí el enlace de Booking, Airbnb o la web del hotel y pulsa **«Traer datos»**. La app lee la página y:

- rellena el **nombre** y, si puede, **sitúa el alojamiento en el mapa** (usa las coordenadas del enlace o busca el sitio por su nombre);
- guarda una **foto** y una descripción, que se ven en la ficha de la reserva (como la miniatura que sale al compartir un enlace en WhatsApp).

Es una ayuda: todo se puede **rellenar o corregir a mano**, y el enlace se guarda aunque la página no deje leer nada. La foto es la principal del anuncio, no la galería entera (esa solo la enseña su web o su app). Para enlaces privados de confirmación que piden iniciar sesión puede que no haya foto; el enlace se guarda igual y se abre dentro de la app. En el móvil, para leer la página hace falta el ayudante de Gmail (Ajustes → Correo); en el programa de Windows no.

Los datos de una reserva también se pueden rellenar **desde el correo**: en **Correos**, abre el correo de la reserva y pulsa «Crear reserva con este correo».

---

## Importar lugares y rutas al mapa

En **Mapa → Importar** hay una pestaña «Cómo exportar» con estas mismas instrucciones.

- **Google Maps, un lugar o una ruta:** Compartir → Copiar enlace → pegarlo en «Enlaces» (se pueden pegar muchos a la vez). Las rutas con paradas se añaden como lugares más una línea que los une en orden.
- **Google Maps, listas guardadas:** [Google Takeout](https://takeout.google.com) → solo «Guardado» (y «Mapas (tus sitios)») → importar los `.csv` de cada lista o `Sitios guardados.json`. Las listas no traen coordenadas: la app busca cada sitio por su nombre (uno por segundo) y deja revisar el resultado antes de añadirlo.
- **Google My Maps:** menú ⋮ → Descargar KML → importar el `.kml`/`.kmz` (conserva capas, notas, rutas y colores).
- **Apple Maps:** Compartir → Copiar en cada lugar o ruta y pegar los enlaces. **Apple Maps no permite exportar guías completas**, así que hay que compartir los lugares uno a uno.
- **GPX** (Komoot, Wikiloc, relojes…) y **GeoJSON** también se importan.

Al importar, la app **descarta las indicaciones de navegación** (los «Gira a la izquierda», «Turn left», «En la rotonda»… que traen algunas rutas) para que no se cuelen como lugares; la ruta en sí sí se conserva, y se avisa de cuántas se han omitido. Si un viaje ya tenía algunas de antes, en el **Mapa** aparece un aviso para quitarlas de golpe.

En el **Mapa** aparece todo lo que tenga ubicación: los lugares, el **alojamiento** y las reservas (hoteles, restaurantes, actividades) que se hayan buscado al crearlas, los vuelos y trayectos, y las rutas. Un plan escrito a mano en el itinerario no sale en el mapa porque no tiene un sitio concreto; para que salga, añádelo como lugar o búscale la dirección en la reserva.

En el panel del mapa, bajo **«Mostrar en el mapa»**, hay un interruptor por cada tipo (Visitar, Comer, Alojamiento, Vuelos, Rutas…): tócalo para ocultar o volver a mostrar esa capa y ver el mapa más limpio. «Ver todo» lo restablece.

---

## Rutas (seguir un recorrido)

La pestaña **Rutas** sirve para importar recorridos (un sendero, una ruta en coche o a pie) y **seguirlos viendo tu posición encima**.

- **Importar:** pulsa «Importar ruta» y elige un archivo **GPX** (Komoot, Wikiloc, Strava, un reloj…), un **KML** de Google My Maps, o pega una ruta de Google o Apple Maps.
- **Detalles:** cada ruta tiene un botón «Detalles» con su distancia, el desnivel de subida y bajada, la altitud mínima y máxima, un **perfil de altitud** y una **dificultad orientativa** (calculada a partir de la distancia y la subida; no mide lo técnico del terreno). El desnivel y el perfil solo aparecen si el archivo trae altitud (los GPX de senderismo suelen traerla).
- **Empezar / Seguir:** pulsa «Empezar» en una ruta (o «Empezar ruta» desde Detalles). Se abre un mapa a pantalla completa con la línea del recorrido y un punto azul con tu ubicación en vivo. Abajo se ve cuánto queda, el porcentaje hecho y, si te sales, a qué distancia estás de la línea. El alojamiento y los lugares del viaje salen tenues como referencia.
- Funciona **sin conexión**: los puntos de la ruta están guardados y el mapa usa los trozos que ya se hayan visto. Hace falta dar permiso de **ubicación** y conviene llevar el móvil cargado (la pantalla se mantiene encendida mientras sigues).
- Para **indicaciones calle a calle** (voz, giros), usa «Abrir en Maps»: eso abre Google o Apple Maps, que es lo que sabe navegar de verdad.

---

## Límites y decisiones honestas

- **Duración de los trayectos:** no se calcula, porque las horas de salida y llegada son locales y pueden estar en husos horarios distintos; se muestra la distancia.
- **Estado de los vuelos en directo:** no está incluido (los servicios fiables son de pago).
- **El tiempo:** solo hay previsión real hasta 16 días vista (Open-Meteo). Para viajes más lejanos no se muestra nada en vez de inventar.
- **Búsqueda de lugares:** usa OpenStreetMap (Nominatim), que solo permite búsquedas al pulsar «Buscar» y una por segundo. Por eso no autocompleta mientras se escribe.
- **Espacio:** el plan gratuito de Supabase incluye 1 GB para archivos y 500 MB de base de datos; las fotos se reducen antes de subirlas. Archivos de hasta 50 MB. En **Ajustes → Espacio para archivos** se ve lo usado, aparece un aviso al 80 % y **«Liberar espacio»** lista todos los archivos de mayor a menor para borrar los que sobren. Las guías grandes se pueden guardar como enlace y no ocupan nada.
- **Sin conexión:** se ve todo lo ya cargado (incluidos los trozos de mapa visitados en el móvil). Los documentos se pueden dejar guardados en el dispositivo con «Guardar sin conexión» (en el programa desde un USB, se copian todos solos); los correos necesitan conexión.

---

## Para desarrollar

```bash
npm install            # dependencias (Electron, pruebas)
npm test               # pruebas de los importadores
npm run serve          # la web en http://localhost:5173
npm start              # el programa de escritorio
```

- `web/` — la aplicación (HTML, CSS y módulos JS sin paso de compilación; Preact + htm, Leaflet, supabase-js).
- `desktop/` — envoltorio de Electron para Windows.
- `backend/` — script SQL de Supabase y ayudante de Gmail.
- `.github/workflows/` — instalador de Windows, publicación de la web y mantenimiento.

Créditos de datos y librerías: mapas de OpenFreeMap y OpenMapTiles con datos © colaboradores de OpenStreetMap, dibujados con MapLibre GL (BSD-3) y su enlace con Leaflet (ISC); búsqueda Nominatim y Photon; tiempo Open-Meteo (CC BY 4.0); aeropuertos OurAirports (dominio público); iconos Lucide (ISC); letra Newsreader (OFL); Preact (MIT), htm (Apache-2.0), Leaflet (BSD-2), JSZip (MIT), supabase-js (MIT) y qrcode-generator (MIT).
