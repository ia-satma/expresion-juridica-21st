# Transferencia a la cuenta de Replit del cliente

El repositorio queda preparado para importar el proyecto desde GitHub. El código no contiene la base de producción, el bucket, Secrets, cookies ni medios privados. La transferencia de esos datos se hace desde Replit y por un canal seguro.

La configuración base no añade `X-Robots-Tag: noindex` para que la publicación del cliente pueda ser indexada. Si se necesita un staging, añade ese encabezado sólo en el Deployment de staging.

## Importar el proyecto

1. En la cuenta del cliente importa `https://github.com/ia-satma/expresion-juridica-21st.git`.
2. Conserva Node 20 o superior y ejecuta `npm ci`.
3. Comprueba que `.replit` mantiene `npm start`, Cloud Run y el puerto 3000.
4. Activa App Storage en el nuevo proyecto. El código usa el bucket predeterminado de esa cuenta cuando `REPLIT_OBJECT_STORAGE_BUCKET_ID` y `DEFAULT_OBJECT_STORAGE_BUCKET_ID` quedan vacíos. Si el cliente crea un bucket nombrado, guarda su identificador en Secrets o Configuration de Replit, nunca en Git.

`.replit` usa `CMS_DATA_SCOPE=development` en el workspace y fija `CMS_DATA_SCOPE=production` en el comando de arranque del Deployment. Si sustituyes ese comando en Publishing, conserva `env CMS_DATA_SCOPE=production npm start`.

## Secrets y configuración

Configura estos valores en Secrets o Configuration de Replit.

- `BETTER_AUTH_SECRET` con al menos 32 caracteres aleatorios.
- `BETTER_AUTH_URL` con la URL publicada en la cuenta del cliente.
- `CMS_AUTH_ALLOWED_HOSTS` con los hosts públicos conectados, separados por comas. Incluye el dominio raíz, `www` y el dominio `replit.app`. Acepta patrones como `*.cliente.example` para subdominios controlados. Añade cada dominio nuevo aquí antes de republicar.
- `CMS_OWNER_EMAIL` con la cuenta propietaria del cliente.
- `CMS_DATA_SCOPE=production` en el Deployment.
- `CMS_AUTH_STORAGE=postgres` solo en el Deployment. Replit inyecta `DATABASE_URL` cuando se aprovisiona PostgreSQL de producción. Para otra base PostgreSQL, usa `CMS_AUTH_DATABASE_URL` como secreto.
- `OPENAI_API_KEY` en Secrets.
- `OPENAI_TEXT_SERVICE_TIER=fast` y los modelos opcionales que correspondan.

Para PostgreSQL el secreto de autenticación debe permanecer estable. Si `BETTER_AUTH_SECRET` no está configurado, el servidor acepta `SESSION_SECRET` de Replit siempre que tenga al menos 32 caracteres.

## Datos y App Storage

La aplicación separa los archivos por `data/<scope>/`. `data/production/auth.sqlite`, `cms.json`, `better-auth.secret`, los archivos de presentaciones y `storage/media/production` son datos privados de ejecución y no se deben subir a GitHub.

Antes del cambio de cuenta, respalda de forma privada la base de autenticación y el CMS. Conserva el secreto de autenticación si vas a restaurar las sesiones de una base PostgreSQL existente. La aplicación ejecuta las migraciones de Better Auth al iniciar.

En producción, PostgreSQL conserva las credenciales, sesiones y controles de intentos de acceso. App Storage conserva `cms.json` y los objetos del CMS. El workspace de desarrollo puede seguir usando SQLite. En Publishing, activa la base de producción y deja desmarcada la copia de los datos de desarrollo.

Replit puede comparar el esquema PostgreSQL del workspace con el de producción. Antes de republicar, revisa las migraciones que presenta Publishing. Si el plan contiene `DROP TABLE` para autenticación, cancela el despliegue. Ejecuta `migrateAuthDatabase()` y espera `createUserSecurity(...).ready` en la base PostgreSQL de desarrollo para alinear el esquema. Este paso crea tablas e índices vacíos. La base de producción conserva sus propias filas.

Para una base PostgreSQL vacía, añade temporalmente `CMS_OWNER_BOOTSTRAP_PASSWORD` en **Production app secrets**. En una recuperación desde SQLite, se usa el ID del propietario existente del CMS y la contraseña proporcionada por el operador. Las demás credenciales de SQLite requieren una migración de datos o volver a crear el acceso desde el panel. En una instalación nueva, el servidor guarda la cuenta propietaria en App Storage antes de completar su creación. Retira el secreto temporal tras comprobar el acceso y republica para confirmar que se conserva. El registro público de cuentas se mantiene cerrado con PostgreSQL.

En App Storage, copia los objetos del bucket anterior al bucket de la cuenta nueva. Deben conservarse los prefijos `production/`, `production/studio-state/`, `production/presentations/` y los nombres de los medios registrados en `cms.json`. Comprueba desde el CMS que Biblioteca, trabajos, documentos, presentaciones, posts y solicitudes muestran sus registros después de la copia.

No se deben copiar al repositorio archivos de `data/`, `storage/`, exportaciones, cookies o Secrets. Ejecuta `node scripts/check-replit-transfer.mjs` antes de cada push de la entrega.

## Publicar y comprobar

Después de importar los datos privados y configurar Secrets:

1. Publica con `npm start` desde la configuración de Deployment.
2. Abre `/admin/` con el propietario y confirma que la sesión, los usuarios, la Biblioteca, App Storage y las solicitudes cargan.
3. Genera una pieza de prueba en un scope de trabajo y confirma que los estados del estudio sobreviven a un refresh.
4. Comprueba una descarga de documento, una presentación y una pieza social.
5. Ejecuta las regresiones locales antes de la entrega.

Las comprobaciones de portabilidad son reproducibles con `node scripts/check-replit-transfer.mjs`. Las comprobaciones de seguridad y exportación permanecen en los scripts `check-auth-security.mjs`, `check-user-security.mjs`, `check-security.mjs`, `check-documents.mjs`, `check-presentations.mjs` y `check-social-studio.mjs`.
