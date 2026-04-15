# ChatApp Backend

Backend para una aplicación de chat en tiempo real tipo WhatsApp, construido con Node.js.  
**URL producción:** `https://chatapp-private.duckdns.org`

---

## Rutas de los proyectos (para edición en futuras sesiones)

| Proyecto | Ruta local |
|----------|-----------|
| **Backend (este proyecto)** | `C:\Users\Cristian\Desktop\Mis proyectos\chatapp` |
| **Frontend Android** | `C:\Users\Cristian\Desktop\Mis proyectos\ChatApp-Front` |

Ambos proyectos son repositorios git locales. Claude Code puede leer y editar archivos en ambas rutas y hacer commits directamente.

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
│   ├── app.js
│   ├── config/
│   │   ├── database.js         # Pool PostgreSQL
│   │   ├── redis.js            # Cliente Redis + helpers presencia
│   │   └── multer.js           # Subida imágenes y videos
│   ├── middleware/
│   │   └── auth.js             # JWT middleware
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── users.controller.js
│   │   ├── contacts.controller.js
│   │   ├── conversations.controller.js
│   │   └── messages.controller.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── users.routes.js
│   │   ├── contacts.routes.js
│   │   └── conversations.routes.js
│   └── socket/
│       └── handler.js
├── uploads/
│   ├── images/
│   └── videos/
├── schema.sql
├── .env
└── package.json
```

---

## Variables de entorno (.env)

```env
PORT=3000
NODE_ENV=development
JWT_SECRET=cadena_aleatoria_minimo_32_caracteres
JWT_EXPIRES_IN=7d
DATABASE_URL=postgresql://postgres:password@localhost:5432/chatapp
REDIS_URL=redis://localhost:6379
UPLOADS_DIR=uploads
MAX_FILE_SIZE_MB=50
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3001
```

---

## Schema de la base de datos

### `users`
```sql
id UUID PK, email VARCHAR UNIQUE, password_hash VARCHAR,
username VARCHAR(50) UNIQUE, display_name VARCHAR(100),
avatar_url TEXT, bio TEXT, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
```

### `contacts`
Relación direccional. Al aceptar se insertan dos filas (una por dirección).
```sql
id UUID PK, user_id UUID FK, contact_id UUID FK,
status VARCHAR(10) DEFAULT 'accepted',  -- 'pending' | 'accepted' | 'blocked'
requested_by UUID FK, created_at TIMESTAMPTZ
UNIQUE(user_id, contact_id), CHECK(user_id <> contact_id)
```

### `conversations`
```sql
id UUID PK, is_group BOOLEAN, group_name VARCHAR(100),
group_avatar TEXT, created_by UUID FK, created_at TIMESTAMPTZ
```

### `conversation_participants`
```sql
conversation_id UUID FK, user_id UUID FK, joined_at TIMESTAMPTZ,
last_read_at TIMESTAMPTZ,  PRIMARY KEY(conversation_id, user_id)
```

### `messages`
```sql
id UUID PK, conversation_id UUID FK, sender_id UUID FK,
content TEXT, media_url TEXT, media_type VARCHAR(10), created_at TIMESTAMPTZ
```

### `message_reads`
```sql
message_id UUID FK, user_id UUID FK, read_at TIMESTAMPTZ, PRIMARY KEY(message_id, user_id)
```

---

## API REST — Formatos de respuesta confirmados

> Todos los endpoints (excepto /auth/register y /auth/login) requieren `Authorization: Bearer <token>`

### POST /api/conversations
- Body: `{ participant_id }` (directo) o `{ participant_ids[], group_name }` (grupo)
- Respuesta: `ConversationDto` **plano** (sin wrapper `{ conversation: ... }`)
- Si ya existe conversación directa: devuelve el objeto completo con `other_user`
- Solo se puede crear entre usuarios con `status = 'accepted'`

### GET /api/conversations
- Respuesta: `{ conversations: ConversationDto[] }`
- Cada `ConversationDto` incluye:
  - `other_user: { id, username, display_name, avatar_url, online }` para chats directos
  - `last_message: { id, conversation_id, sender_id, content, media_type, created_at }` o `null`
  - `unread_count: number`

### POST /api/conversations/:id/messages
- Body: `multipart/form-data` con `content?` y/o `media?`
- Respuesta: `MessageDto` **plano** (sin wrapper `{ message: ... }`)
- `sender` es objeto anidado: `{ id, username, display_name, avatar_url }`
- Emite evento socket `new_message` con el mismo formato

### GET /api/conversations/:id/messages
- Query: `?before=<message_id>&limit=50`
- Respuesta: `{ messages: MessageDto[], has_more }`
- Mensajes en orden DESC (newest first) — el cliente invierte para mostrar
- Cada mensaje incluye `sender` como objeto anidado
- Marca la conversación como leída (`last_read_at = NOW()`)

### Contactos — /api/contacts
| Método | Ruta | Body | Descripción |
|--------|------|------|-------------|
| GET | `/` | — | Contactos aceptados con online |
| GET | `/pending` | — | Solicitudes recibidas |
| POST | `/request` | `{ username }` | Envía solicitud |
| POST | `/:id/accept` | — | Acepta (`:id` = request_id, no userId) |
| POST | `/:id/reject` | — | Rechaza |
| DELETE | `/:contactId` | `{ block?: true }` | Elimina o bloquea |

---

## Eventos Socket.io

```js
// Conexión
io('https://chatapp-private.duckdns.org', { auth: { token: 'Bearer <jwt>' } })
```

### Cliente → Servidor
| Evento | Payload |
|--------|---------|
| `join_conversation` | `conversationId` (string) |
| `typing_start` | `{ conversation_id }` |
| `typing_stop` | `{ conversation_id }` |
| `mark_read` | `{ conversation_id }` |

### Servidor → Cliente
| Evento | Payload |
|--------|---------|
| `new_message` | `MessageDto` con `sender` anidado |
| `typing_start` | `{ conversation_id, user: { id, username } }` |
| `typing_stop` | `{ conversation_id, user: { id, username } }` |
| `messages_read` | `{ conversation_id, user_id, read_at }` |
| `presence` | `{ user_id, online }` |
| `contact_request` | `{ id (request_id), from: { id, username } }` |
| `contact_accepted` | `{ id, user_id }` |
| `contact_rejected` | `{ id }` |

Al conectar: el servidor une el socket a todas las salas `conversation:<id>` del usuario y a `user:<id>`.

---

## Presencia online (Redis)

- Conectar: `online:<userId>` con TTL 35s
- Heartbeat cada 25s
- Desconectar: elimina clave, notifica contactos

---

## Correr localmente

```bash
npm install
cp .env.example .env   # editar DATABASE_URL y JWT_SECRET
psql -U postgres -c "CREATE DATABASE chatapp;"
psql -U postgres -d chatapp -f schema.sql
npm run dev            # nodemon, puerto 3000
```

---

## Desplegar en VPS

```bash
git pull
npm install --omit=dev
pm2 reload chatapp     # zero-downtime
```
