# CMS de Expresión Jurídica

El sitio público sigue viviendo en `sitio/`. El servidor Express lo entrega con sus valores originales como fallback y aplica los valores publicados desde el CMS antes de responder HTML.

## Arranque local

```bash
npm install
cp .env.example .env
npm start
```

Abre `http://localhost:3000/admin/`. En el primer arranque, la primera cuenta que se registra queda como propietaria del CMS. Después de crearla, los registros públicos de alta quedan bloqueados.

## Autenticación

El login usa Better Auth con email y contraseña, sesiones persistentes en SQLite (`data/auth.sqlite`) y un secreto en `BETTER_AUTH_SECRET`. La ruta de Better Auth es `/api/auth/*`; el CMS consulta `/api/cms/auth-state` para resolver el rol editorial. En producción, define `BETTER_AUTH_SECRET` y `BETTER_AUTH_URL` en Replit Secrets.

## Contenido

- `GET /admin/` abre el panel.
- `Páginas` inventaría todas las rutas HTML y sus campos editables.
- Cada cambio queda como borrador en `data/cms.json`.
- `Publicar cambios` copia el snapshot al estado público.
- `Vista previa` añade `?cms_preview=1` y sólo muestra el borrador a una sesión autorizada.
- `Versiones` permite restaurar un snapshot como borrador.

El inventario incluye HTML de texto, títulos, metadatos, enlaces, `href`, `src`, `srcset`, posters, `alt`, `aria-label`, placeholders y otros atributos visibles. Los campos HTML se sanitizan para retirar scripts, estilos y handlers inline.

## Medios

La Biblioteca guarda archivos en `storage/media` y registra una referencia persistente en el CMS. El panel permite reutilizarlos en campos de imagen, video, audio y documentos. En Replit, monta un almacenamiento persistente para esa carpeta antes de publicar.

## Cambiar a PostgreSQL

Better Auth está encapsulado en `server/auth.mjs`; la instancia actual usa SQLite para que el proyecto funcione sin servicios externos. Si Replit proporciona PostgreSQL, cambia el adaptador de Better Auth por `drizzleAdapter` y conserva las rutas `/api/auth/*`, el contrato de `/api/cms/auth-state` y la matriz de permisos del panel.
