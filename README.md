# Yape Notification Monitor

Este proyecto es un sistema interno y privado para negocios que detecta de forma automática los pagos recibidos en la aplicación **Yape (BCP, Perú)** a través de las notificaciones de Android y los reporta en tiempo real en un panel web (Dashboard).

El sistema consta de dos partes principales:
1. **Sensor Android (`/sensor`)**: Una aplicación nativa en Kotlin que escucha las notificaciones del paquete de Yape, parsea el remitente y monto usando una expresión regular tolerante a variaciones, y encola localmente (Room + WorkManager) los pagos para enviarlos al backend de forma segura y garantizada.
2. **Servidor y Dashboard (`/server`)**: Un backend con Node.js, Express y SQLite para almacenar los pagos, WebSocket (Socket.io) para transmitir las alertas instantáneamente y un dashboard en React + Tailwind CSS con un diseño móvil-first para validación de ventas en el mostrador.

---

## Estructura del Repositorio

```text
├── sensor/           # Código fuente de la app de Android (Kotlin)
├── server/           # Backend (Express + SQLite) y carpeta del frontend de React
├── frontend/         # Código fuente de la interfaz de React (Vite + Tailwind)
├── Dockerfile        # Definición de contenedor multi-stage
├── docker-compose.yml# Orquestación del servicio y volumen persistente
└── README.md         # Esta guía de usuario
```

---

## Parte 1: App Android "Sensor" (`/sensor`)

### Cómo compilar e instalar el APK del sensor
1. Instala y abre **Android Studio** (Koala o versión superior recomendada).
2. Selecciona **Open** y navega hasta el directorio `sensor/` de este proyecto.
3. Deja que Gradle sincronice las dependencias. La app tiene como requisitos mínimos `minSdk = 26` (Android 8.0) y utiliza `Java 17`.
4. Para generar el APK listo para producción sin subirlo a la Play Store:
   - En Android Studio ve al menú superior: **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
   - Una vez finalizada la compilación, se abrirá un aviso en la esquina inferior derecha. Haz clic en **locate** para ver el archivo `app-debug.apk` o `app-release-unsigned.apk`.
5. Transfiere este archivo `.apk` al dispositivo Android del negocio (mediante USB, WhatsApp Web, Telegram, o correo) e instálalo habilitando la opción de **Instalar aplicaciones de fuentes desconocidas** si tu teléfono te lo solicita.

### Cómo activar el permiso de "Acceso a notificaciones"
Android protege celosamente la lectura de notificaciones por motivos de privacidad. Por ello, es obligatorio habilitar el permiso de forma manual:
1. Al abrir la aplicación **Yape Sensor** por primera vez, verás una tarjeta de color rojo indicando **"PERMISO REQUERIDO"**.
2. Presiona el botón rojo **"Activar Acceso a Notificaciones"**.
3. Esto te redirigirá automáticamente a la pantalla de configuración del sistema de Android llamada **Acceso a notificaciones**.
4. Busca en la lista la aplicación **Yape Sensor** y activa el interruptor.
5. Confirma la advertencia de seguridad que muestra el sistema operativo (es un aviso estándar para servicios que leen notificaciones).
6. Regresa a la app. Verás que la tarjeta ahora es de color verde y muestra **"LECTOR DE NOTIFICACIONES ACTIVO"**.

### Cómo generar la API Key y configurar la URL en la app
1. **Generar la API Key**: Define una clave segura y secreta en tu backend (se configura en la variable de entorno `YAPE_API_KEY`, por ejemplo: `MiClaveUltraSecretaYape2026`).
2. **Configurar la App**:
   - En la aplicación móvil, introduce la **URL del Backend**. Ejemplos:
     - Local (mismo WiFi en desarrollo): `http://192.168.1.50:3000` (el endpoint `/api/pagos` se autocompleta internamente).
     - Producción (Render/Railway): `https://yape-monitor.onrender.com`.
   - Introduce tu **API Key / Token de Seguridad** idéntico al configurado en el servidor.
   - Presiona **Guardar**.
3. **Validación de Conexión**:
   - Para probar que todo está bien, presiona el botón **Test Conexión**. Esto encolará y enviará un pago de prueba con el remitente *"PAGO DE PRUEBA YAPE"* y monto de `S/ 1.00`. Debería aparecer de inmediato en tu Dashboard Web sin recargar la página.

---

## Parte 2: Backend + Dashboard Web (`/server` + `/frontend`)

El backend utiliza SQLite por defecto y expone endpoints seguros. El frontend está optimizado para su visualización responsive y se conecta con WebSockets.

### Variables de Entorno (.env)
El servidor utiliza las siguientes variables (puedes crear un archivo `.env` en la carpeta `/server`):
- `PORT`: Puerto en el que corre el servidor (por defecto `3000`).
- `YAPE_API_KEY`: API Key que debe enviar la app Android en las cabeceras (`X-API-Key`) para validar que el pago es verídico.
- `DASHBOARD_USERNAME`: Usuario para acceder al dashboard web (por defecto `admin`).
- `DASHBOARD_PASSWORD`: Contraseña para acceder al dashboard web (por defecto `yape1234`).
- `JWT_SECRET`: Clave de encriptación para firmar los tokens de sesión del Dashboard.
- `DATABASE_PATH`: Ruta al archivo SQLite local (por defecto `data/yape_payments.db`).

---

## Despliegue e Infraestructura

### Opción A: Despliegue rápido local con Docker (Recomendado)
Para levantar el servidor y base de datos con persistencia en un solo comando:
1. Asegúrate de tener instalado **Docker** y **Docker Compose** en tu PC o servidor local.
2. Abre una terminal en la raíz del proyecto.
3. Ejecuta:
   ```bash
   docker compose up -d --build
   ```
4. El contenedor compilará el frontend de React automáticamente y lo servirá de manera estática a través del servidor Express en el puerto `3000`.
5. Accede desde tu navegador web a: `http://localhost:3000`.
6. La base de datos SQLite se guardará de forma segura y persistente en el volumen de Docker `yape-data`.

### Opción B: Ejecución en desarrollo sin Docker
1. **Backend**:
   - Entra a la carpeta `/server`: `cd server`
   - Configura tus variables de entorno en el archivo `.env`.
   - Inicia en desarrollo (requiere `nodemon` instalado): `npm run dev` o simplemente `npm start`.
2. **Frontend**:
   - Entra a la carpeta `/frontend`: `cd frontend`
   - Instala dependencias: `npm install`
   - Configura la URL del backend en desarrollo creando un archivo `.env` local en la carpeta `/frontend`:
     ```text
     VITE_API_URL=http://localhost:3000
     ```
   - Inicia el servidor de desarrollo Vite: `npm run dev`
   - El dashboard web estará disponible en `http://localhost:5173`.
3. **Compilar y publicar producción sin Docker**:
   - Corre `npm run build` en `/frontend`.
   - Copia la carpeta `/frontend/dist/*` a `/server/public/`.
   - Corre `npm start` en la carpeta `/server`.

### Opción C: Despliegue en la Nube (Railway, Render, VPS)

#### En Render o Railway (Servicios PaaS económicos):
Como hemos empaquetado el frontend y el backend en un solo servidor de Node.js que expone un único puerto (`3000`), el despliegue es sumamente barato y sencillo:
1. Sube este repositorio a tu cuenta de **GitHub** de forma privada (muy importante ya que contiene claves del negocio).
2. Vincula el repositorio en **Render** o **Railway** seleccionando un servicio de tipo **Web Service**.
3. **Parámetros del servicio**:
   - Directorio raíz: Dejar vacío (usa el root con nuestro `Dockerfile`).
   - El sistema detectará automáticamente el `Dockerfile` y realizará la compilación multi-stage de React + Express sin que debas configurar nada más.
4. **Variables de entorno (Environment Variables)**:
   - Configura `YAPE_API_KEY`, `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`, `JWT_SECRET` en la consola de Render/Railway.
5. **Persistencia (BBDD)**:
   - SQLite es perfecto por su simplicidad. Para evitar perder los pagos cada vez que el contenedor de Render/Railway se reinicie, monta un **Disk / Persistent Volume** de al menos `1 GB` apuntando a la ruta `/app/data` de tu contenedor. Esto asegurará que tu archivo `yape_payments.db` persista para siempre.
   - Alternativamente, la conexión a Postgres es estándar y se puede cambiar modificando la inicialización en `database.js` si el volumen de ventas crece masivamente.

---

## Formato de Notificaciones Soportado (Expresión Regular)
El filtro regex del sensor busca y extrae información bajo patrones como:
- *¡Te han yapeado S/ 50.00 de Juan Perez!*
- *Te yapeó S/ 1,250.50 de Maria Gomez*
- *Te yapeó S/15 de Carlos.*
- *Te yapeó S/ 5,50 de Pedro Ramos*

Si la aplicación Yape cambia la estructura o frase en el futuro, puedes modificar fácilmente la constante regex en `YapeNotificationParser.kt` dentro del proyecto Android y volver a compilar el APK.
