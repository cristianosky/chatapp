# ChatApp Backend

Backend para una aplicación de chat en tiempo real tipo WhatsApp, construido con Node.js.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js 18+ |
| Framework HTTP | Express 4 |
| Tiempo real | Socket.io 4 |
| Base de datos | PostgreSQL 16 |
| ORM / queries | node-postgres (`pg`) — SQL plano, sin ORM |
| Caché / presencia | Redis 7 |
| Autenticación | JWT (`jsonwebtoken`) + bcrypt (`bcryptjs`) |
| Subida de archivos | Multer 2 |
| Proceso en prod | PM2 (modo cluster) |
| Proxy inverso | Nginx |

---

## Estructura de carpetas

```
chatapp/
├── src/
│   ├── app.js                          # Punto de entrada: Express, Socket.io, middlewares, rutas
│   ├── config/
│   │   ├── database.js                 # Pool de conexiones PostgreSQL (pg.Pool)
│   │   ├── redis.js                    # Cliente Redis + helpers de presencia online
│   │   └── multer.js                   # Configuración de subida de imágenes y videos
│   ├── middleware/
│   │   └── auth.js                     # Middleware JWT: verifica Bearer token, inyecta req.user
│   ├── controllers/
│   │   ├── auth.controller.js          # Registro, login, perfil propio
│   │   ├── users.controller.js         # Búsqueda de usuarios, actualizar perfil, cambiar contraseña
│   │   ├── contacts.controller.js      # Listar, agregar y eliminar contactos
│   │   ├── conversations.controller.js # Crear y listar chats directos y grupales
│   │   └── messages.controller.js      # Enviar, listar (cursor) y eliminar mensajes
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── users.routes.js
│   │   ├── contacts.routes.js
│   │   └── conversations.routes.js     # También contiene las rutas de mensajes (anidadas)
│   └── socket/
│       └── handler.js                  # Todos los eventos Socket.io (auth, rooms, typing, presencia)
├── uploads/
│   ├── images/                         # Imágenes subidas (servidas en /uploads/images/...)
│   └── videos/                         # Videos subidos (servidos en /uploads/videos/...)
├── schema.sql                          # DDL completo de PostgreSQL (idempotente con IF NOT EXISTS)
├── .env                                # Variables de entorno locales (no commitear)
├── .env.example                        # Plantilla de variables de entorno
├── .gitignore
├── ecosystem.config.js                 # Configuración PM2 para producción
├── nginx.conf                          # Config Nginx lista para VPS + SSL
└── package.json
```

---

## Variables de entorno

Archivo `.env` en la raíz del proyecto (copiar desde `.env.example`):

```env
PORT=3000
NODE_ENV=development

JWT_SECRET=cadena_aleatoria_larga_minimo_32_caracteres
JWT_EXPIRES_IN=7d

DATABASE_URL=postgresql://postgres:tupassword@localhost:5432/chatapp

REDIS_URL=redis://localhost:6379

UPLOADS_DIR=uploads
MAX_FILE_SIZE_MB=50

# URLs del frontend separadas por coma
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3001
```

---

## Schema de la base de datos

### Tabla `users`

```sql
id            UUID        PK, gen_random_uuid()
email         VARCHAR     UNIQUE NOT NULL
password_hash VARCHAR     NOT NULL
username      VARCHAR(50) UNIQUE NOT NULL
display_name  VARCHAR(100)
avatar_url    TEXT
bio           TEXT
created_at    TIMESTAMPTZ DEFAULT NOW()
updated_at    TIMESTAMPTZ DEFAULT NOW()  -- actualizado por trigger
```

### Tabla `contacts`

Relación direccional: user_id agregó a contact_id.

```sql
id         UUID PK
user_id    UUID FK → users(id) ON DELETE CASCADE
contact_id UUID FK → users(id) ON DELETE CASCADE
created_at TIMESTAMPTZ
UNIQUE (user_id, contact_id)
CHECK  (user_id <> contact_id)
```

### Tabla `conversations`

```sql
id           UUID    PK
is_group     BOOLEAN DEFAULT FALSE
group_name   VARCHAR(100)
group_avatar TEXT
created_by   UUID FK → users(id)
created_at   TIMESTAMPTZ
```

### Tabla `conversation_participants`

```sql
conversation_id UUID FK → conversations(id) ON DELETE CASCADE
user_id         UUID FK → users(id)         ON DELETE CASCADE
joined_at       TIMESTAMPTZ
last_read_at    TIMESTAMPTZ   -- usado para calcular mensajes no leídos
PRIMARY KEY (conversation_id, user_id)
```

### Tabla `messages`

```sql
id              UUID PK
conversation_id UUID FK → conversations(id) ON DELETE CASCADE
sender_id       UUID FK → users(id)         ON DELETE SET NULL
content         TEXT
media_url       TEXT
media_type      VARCHAR(10)  -- 'image' | 'video' | NULL
created_at      TIMESTAMPTZ
```

### Tabla `message_reads`

Confirmaciones de lectura individuales por usuario (doble tick).

```sql
message_id UUID FK → messages(id) ON DELETE CASCADE
user_id    UUID FK → users(id)    ON DELETE CASCADE
read_at    TIMESTAMPTZ
PRIMARY KEY (message_id, user_id)
```

---

## API REST

Todos los endpoints (excepto registro y login) requieren header:

```
Authorization: Bearer <token>
```

### Autenticación — `/api/auth`

| Método | Ruta | Body | Descripción |
|--------|------|------|-------------|
| `POST` | `/register` | `{ email, password, username, display_name? }` | Crea cuenta, devuelve JWT + usuario |
| `POST` | `/login` | `{ email, password }` | Devuelve JWT + usuario |
| `GET` | `/me` | — | Perfil del usuario autenticado |

### Usuarios — `/api/users`

| Método | Ruta | Params / Body | Descripción |
|--------|------|---------------|-------------|
| `GET` | `/search` | `?q=texto` (mín. 2 chars) | Busca usuarios por username (máx. 20 resultados) |
| `GET` | `/:username` | — | Perfil público + estado online |
| `PATCH` | `/me` | `multipart/form-data`: `display_name?`, `bio?`, `avatar` (imagen) | Actualiza perfil |
| `POST` | `/change-password` | `{ current_password, new_password }` | Cambia contraseña |

### Contactos — `/api/contacts`

| Método | Ruta | Body | Descripción |
|--------|------|------|-------------|
| `GET` | `/` | — | Lista de contactos con estado online |
| `POST` | `/` | `{ username }` | Agrega contacto por username |
| `DELETE` | `/:contactId` | — | Elimina contacto por UUID |

### Conversaciones — `/api/conversations`

| Método | Ruta | Body | Descripción |
|--------|------|------|-------------|
| `GET` | `/` | — | Lista de chats (último mensaje + contador de no leídos) |
| `POST` | `/` | `{ participant_id }` para directo; `{ participant_ids[], group_name }` para grupo | Crea conversación (directo: reutiliza si ya existe) |
| `GET` | `/:id` | — | Detalle de conversación + participantes |

### Mensajes — `/api/conversations/:id/messages`

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/` | Historial paginado por cursor (`?before=<message_id>&limit=50`) |
| `POST` | `/` | Envía mensaje. `multipart/form-data`: `content?` (texto) + `media?` (imagen/video) |
| `DELETE` | `/:messageId` | Elimina mensaje propio |

Formatos de archivo permitidos:
- **Imágenes:** JPEG, PNG, GIF, WebP
- **Videos:** MP4, WebM, MOV
- **Tamaño máximo:** configurable con `MAX_FILE_SIZE_MB` (default 50 MB)

---

## Eventos Socket.io

La conexión requiere autenticación por token:

```js
const socket = io('http://localhost:3000', {
  auth: { token: 'Bearer eyJ...' }
})
```

### Cliente → Servidor

| Evento | Payload | Descripción |
|--------|---------|-------------|
| `typing_start` | `{ conversation_id }` | Emite "está escribiendo" al resto de la sala |
| `typing_stop` | `{ conversation_id }` | Cancela indicador de escritura |
| `mark_read` | `{ conversation_id }` | Marca la conversación como leída |
| `join_conversation` | `conversation_id` (string) | Se une a la sala de una nueva conversación |

### Servidor → Cliente

| Evento | Payload | Descripción |
|--------|---------|-------------|
| `new_message` | Objeto `message` completo con datos del sender | Nuevo mensaje en tiempo real |
| `typing_start` | `{ conversation_id, user: { id, username } }` | Otro usuario está escribiendo |
| `typing_stop` | `{ conversation_id, user: { id, username } }` | Otro usuario dejó de escribir |
| `messages_read` | `{ conversation_id, user_id, read_at }` | Alguien leyó los mensajes (doble tick) |
| `presence` | `{ user_id, online: boolean }` | Estado online de un contacto |

Al conectar, el servidor une automáticamente al socket a todas las salas `conversation:<id>` del usuario.

---

## Presencia online (Redis)

- Al conectar: se guarda clave `online:<userId>` en Redis con TTL de 35 segundos.
- Heartbeat: cada 25 segundos el servidor renueva la clave.
- Al desconectar: la clave se elimina inmediatamente y se notifica a los contactos.
- Si Redis no está disponible, la app sigue funcionando; solo la presencia queda deshabilitada.

---

## Correr localmente

### Requisitos

- Node.js 18+
- PostgreSQL 16 corriendo en `localhost:5432`
- Redis 7 (opcional — solo para presencia online)

### Pasos

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# Editar .env con tu DATABASE_URL y JWT_SECRET

# 3. Crear la base de datos (si no existe)
psql -U postgres -c "CREATE DATABASE chatapp;"

# 4. Aplicar el schema
psql -U postgres -d chatapp -f schema.sql

# 5. Arrancar en modo desarrollo (nodemon)
npm run dev
```

El servidor queda disponible en:
- REST API: `http://localhost:3000/api`
- WebSocket: `ws://localhost:3000`
- Health: `http://localhost:3000/health`

### Redis con Docker (opcional)

```bash
docker run -d --name chatredis -p 6379:6379 redis:7
```

### Pruebas rápidas con curl

```bash
# Registrar usuario
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@test.com","password":"123456","username":"ana"}'

# Login (guarda el token devuelto)
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"ana@test.com","password":"123456"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

# Ver perfil propio
curl http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer $TOKEN"

# Buscar usuarios
curl "http://localhost:3000/api/users/search?q=ana" \
  -H "Authorization: Bearer $TOKEN"

# Enviar mensaje con imagen
curl -X POST http://localhost:3000/api/conversations/<conv_id>/messages \
  -H "Authorization: Bearer $TOKEN" \
  -F "content=Hola!" \
  -F "media=@/ruta/a/imagen.jpg"
```

---

## Desplegar en VPS Ubuntu

### 1. Preparar el servidor

```bash
# Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PostgreSQL 16
sudo apt install -y postgresql-16

# Redis 7
sudo apt install -y redis-server
sudo systemctl enable redis-server

# Nginx
sudo apt install -y nginx

# PM2
sudo npm install -g pm2

# Certbot (SSL)
sudo apt install -y certbot python3-certbot-nginx
```

### 2. Clonar y configurar la app

```bash
git clone <repo> /var/www/chatapp
cd /var/www/chatapp
cp .env.example .env
# Editar .env con valores de producción:
#   NODE_ENV=production
#   JWT_SECRET=cadena_muy_larga_y_aleatoria
#   DATABASE_URL=postgresql://chatuser:password@localhost:5432/chatapp
#   REDIS_URL=redis://localhost:6379
#   ALLOWED_ORIGINS=https://tu-dominio.com

npm install --omit=dev
```

### 3. Base de datos

```bash
sudo -u postgres psql -c "CREATE USER chatuser WITH PASSWORD 'password_seguro';"
sudo -u postgres psql -c "CREATE DATABASE chatapp OWNER chatuser;"
psql $DATABASE_URL -f schema.sql
```

### 4. Nginx

```bash
# Editar nginx.conf: reemplazar your-domain.com con tu dominio real
sudo cp nginx.conf /etc/nginx/sites-available/chatapp
sudo ln -s /etc/nginx/sites-available/chatapp /etc/nginx/sites-enabled/
sudo nginx -t

# SSL con Let's Encrypt
sudo certbot --nginx -d tu-dominio.com

sudo systemctl reload nginx
```

### 5. PM2

```bash
cd /var/www/chatapp
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # genera y ejecuta el comando para arranque automático
```

### 6. Actualizaciones futuras

```bash
cd /var/www/chatapp
git pull
npm install --omit=dev
pm2 reload chatapp   # zero-downtime reload
```

### Firewall recomendado

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'   # puertos 80 y 443
sudo ufw enable
# No exponer 3000, 5432 ni 6379 al exterior
```

---

## Seguridad en producción

- Usar un `JWT_SECRET` de al menos 64 caracteres aleatorios (`openssl rand -hex 32`).
- Los puertos 3000 (Node), 5432 (PostgreSQL) y 6379 (Redis) deben estar cerrados en el firewall; solo Nginx habla con Node.
- PostgreSQL y Redis deben escuchar únicamente en `localhost` (configuración por defecto en Ubuntu).
- Los archivos subidos en `uploads/` se sirven directamente por Nginx sin pasar por Node.
- Nginx bloquea la ejecución de scripts dentro de `uploads/` (ver config).
