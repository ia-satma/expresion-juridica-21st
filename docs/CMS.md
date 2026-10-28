# CMS de Expresión Jurídica

El sitio público sigue viviendo en `sitio/`. El servidor Express lo entrega con sus valores originales como fallback y aplica los valores publicados desde el CMS antes de responder HTML.

## Arranque local

```bash
npm install
cp .env.example .env
npm start
```

Abre `http://localhost:3000/admin/`. En el primer arranque, la primera cuenta que se registra queda como propietaria del CMS. Después de crearla, los registros públicos de alta quedan bloqueados.

## Actualizar Replit

Después de un `git push`, abre el panel `Git` de Replit, ejecuta `Fetch` y `Pull`, y luego `Republish` para que el dominio publicado use el mismo commit. La configuración de producción debe conservar `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` y `CMS_OWNER_EMAIL` en Secrets/Configurations.

## Autenticación

El login usa Better Auth con email y contraseña, sesiones persistentes en SQLite (`data/auth.sqlite`) y un secreto en `BETTER_AUTH_SECRET`. La ruta de Better Auth es `/api/auth/*`; el CMS consulta `/api/cms/auth-state` para resolver el rol editorial. En producción, define `BETTER_AUTH_SECRET` y `BETTER_AUTH_URL` en Replit Secrets.

El primer registro de `ia@satma.mx` se convierte en `owner` (puedes cambiarlo con `CMS_OWNER_EMAIL`). Desde `Ajustes → Usuarios` el propietario puede crear cuentas y asignar `owner`, `editor` o `viewer`; el plugin Admin de Better Auth conserva el rol de autenticación, las sesiones y el estado bloqueado. El servidor impide editar, publicar, subir medios o modificar configuración sin el rol correspondiente.

El CMS también admite Google OAuth. Configura `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` en Replit Secrets y registra estas URI de redirección en Google Cloud: `https://expresion-juridica-21-st.replit.app/api/auth/callback/google` y `http://localhost:3000/api/auth/callback/google`. `ia@satma.mx` siempre queda como propietaria; las cuentas del dominio `CMS_GOOGLE_ALLOWED_DOMAIN` se aprovisionan automáticamente con `CMS_GOOGLE_DEFAULT_ROLE` (por defecto, `viewer`).

## Contenido

- `GET /admin/` abre el panel.
- `Páginas` inventaría todas las rutas HTML y sus campos editables.
- Cada cambio queda como borrador en `data/cms.json`.
- `Publicar cambios` copia el snapshot al estado público.
- `Vista previa` añade `?cms_preview=1` y sólo muestra el borrador a una sesión autorizada.
- `Versiones` permite restaurar un snapshot como borrador.

`Ajustes` centraliza el nombre y descripción SEO, URL canónica, indexación, token de Google Search Console, Google Analytics, consentimiento de cookies, datos GEO y visibilidad de enlaces del menú. Los cambios se guardan en `data/cms.json` y se inyectan en cada respuesta HTML publicada.

El inventario incluye HTML de texto, títulos, metadatos, enlaces, `href`, `src`, `srcset`, posters, `alt`, `aria-label`, placeholders y otros atributos visibles. Los campos HTML se sanitizan para retirar scripts, estilos y handlers inline.

## Medios

La Biblioteca guarda archivos en `storage/media` y registra una referencia persistente en el CMS. El panel permite reutilizarlos en campos de imagen, video, audio y documentos. En Replit, monta un almacenamiento persistente para esa carpeta antes de publicar.

El puente público carga la configuración desde `/api/cms/public`, aplica los overrides, muestra el aviso de cookies y carga Analytics sólo después de aceptar. El servidor genera `/robots.txt`, `/sitemap.xml` y `/llms.txt`, además de `canonical`, `robots`, `google-site-verification` y JSON-LD `LegalService` con los datos GEO.

## Cambiar a PostgreSQL

Better Auth está encapsulado en `server/auth.mjs`; la instancia actual usa SQLite para que el proyecto funcione sin servicios externos. Si Replit proporciona PostgreSQL, cambia el adaptador de Better Auth por `drizzleAdapter` y conserva las rutas `/api/auth/*`, el contrato de `/api/cms/auth-state` y la matriz de permisos del panel.
