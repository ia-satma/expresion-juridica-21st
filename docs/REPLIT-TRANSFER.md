# Transferencia a la cuenta de Replit del cliente

El repositorio queda preparado para importar el proyecto desde GitHub. El código no contiene la base de producción, el bucket, Secrets, cookies ni medios privados. La transferencia de esos datos se hace desde Replit y por un canal seguro.

La configuración base no añade `X-Robots-Tag: noindex` para que la publicación del cliente pueda ser indexada. Si se necesita un staging, añade ese encabezado sólo en el Deployment de staging.

## Importar el proyecto

1. En la cuenta del cliente importa `https://github.com/ia-satma/expresion-juridica-21st.git`.
2. Conserva Node 20 o superior y ejecuta `npm ci`.
3. Comprueba que `.replit` mantiene `npm start`, Cloud Run y el puerto 3000.
4. Activa App Storage en el nuevo proyecto. El código usa el bucket predeterminado de esa cuenta cuando `REPLIT_OBJECT_STORAGE_BUCKET_ID` y `DEFAULT_OBJECT_STORAGE_BUCKET_ID` quedan vacíos. Si el cliente crea un bucket nombrado, guarda su identificador en Secrets o Configuration de Replit, nunca en Git.

## Secrets y configuración

Configura estos valores en Secrets o Configuration de Replit.

- `BETTER_AUTH_SECRET` con al menos 32 caracteres aleatorios.
- `BETTER_AUTH_URL` con la URL publicada en la cuenta del cliente.
- `CMS_OWNER_EMAIL` con la cuenta propietaria del cliente.
- `CMS_DATA_SCOPE=production` en el Deployment.
- `OPENAI_API_KEY` en Secrets.
- `OPENAI_TEXT_SERVICE_TIER=fast` y los modelos opcionales que correspondan.

Si se conservan usuarios y sesiones existentes, conserva también el `BETTER_AUTH_SECRET` actual y transfiere la base SQLite con el procedimiento siguiente. Si se crea una instalación nueva, usa un secreto nuevo y crea el propietario desde el primer arranque.

## Datos y App Storage

La aplicación separa los archivos por `data/<scope>/`. `data/production/auth.sqlite`, `cms.json`, `better-auth.secret`, los archivos de presentaciones y `storage/media/production` son datos privados de ejecución y no se deben subir a GitHub.

Antes del cambio de dominio, genera un respaldo cifrado de la base y del CMS en la cuenta actual. Transfiere de forma privada `auth.sqlite` y `cms.json` al mismo scope en la cuenta nueva, manteniendo permisos de archivo. La aplicación ejecuta las migraciones de Better Auth al iniciar.

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
