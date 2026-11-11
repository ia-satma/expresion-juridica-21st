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

Después de un `git push`, abre el panel `Git` de Replit, ejecuta `Fetch` y `Pull`, y luego `Republish` para que el dominio publicado use el mismo commit. La configuración de producción debe conservar `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `CMS_AUTH_ALLOWED_HOSTS` y `CMS_OWNER_EMAIL` en Secrets/Configurations.

## Autenticación

El login usa Better Auth con email y contraseña. En producción, las credenciales, sesiones y límites de acceso se conservan en PostgreSQL. La ruta de Better Auth es `/api/auth/*`; el CMS consulta `/api/cms/auth-state` para resolver el rol editorial. Define `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` y `CMS_AUTH_ALLOWED_HOSTS` en Replit Secrets. Better Auth resuelve el host y la cookie por solicitud dentro de esa lista, de modo que el acceso funciona desde cada dominio conectado.

El primer registro de `ia@satma.mx` se convierte en `owner` (puedes cambiarlo con `CMS_OWNER_EMAIL`). Desde `Ajustes → Usuarios` el propietario puede crear cuentas y asignar `owner`, `editor` o `viewer`; el plugin Admin de Better Auth conserva el rol de autenticación, las sesiones y el estado bloqueado. El servidor impide editar, publicar, subir medios o modificar configuración sin el rol correspondiente.

El CMS utiliza exclusivamente correo y contraseña. El propietario crea cada usuario desde `Usuarios y accesos`; el sistema genera una contraseña temporal aleatoria, la muestra una sola vez al propietario y obliga al usuario a cambiarla por una contraseña propia de mínimo 8 caracteres en su primer acceso.

Los datos se separan por `CMS_DATA_SCOPE`: usa `development` en el workspace y `production` en el Deployment. Las imágenes y videos usan Replit App Storage con prefijos separados por entorno; en `App Storage` del CMS puedes cargar todos los medios del sitio al bucket conectado. Para una carga inicial desde Shell también puedes ejecutar `node server/import-site-media.mjs`.

## Contenido

- `GET /admin/` abre el panel.
- `Páginas` inventaría todas las rutas HTML y sus campos editables.
- Cada edición se muestra como Antes/Después y se guarda al aceptar, con aplicación pública inmediata.
- No hay un paso separado de «Publicar cambios» para el contenido del cliente.
- `Vista previa` añade `?cms_preview=1` y sólo muestra el estado de revisión a una sesión autorizada.
- `Versiones` permite restaurar un snapshot como borrador.

`Ajustes` centraliza el nombre y descripción SEO, URL canónica, indexación, token de Google Search Console, Google Analytics, consentimiento de cookies, datos GEO y visibilidad de enlaces del menú. Los cambios se guardan en `data/cms.json` y se inyectan en cada respuesta HTML publicada.

El inventario incluye HTML de texto, títulos, metadatos, enlaces, `href`, `src`, `srcset`, posters, `alt`, `aria-label`, placeholders y otros atributos visibles. Los campos HTML se sanitizan para retirar scripts, estilos y handlers inline.

## Usuarios y accesos

El apartado de usuarios es una tabla con correo/usuario, rol, estado, último acceso y acciones. El propietario puede cambiar roles, activar o revocar acceso, restablecer contraseñas temporales y consultar permisos. El historial de accesos recientes, incluidos resultado y origen protegido, sólo se muestra al rol Administrador (`owner`) y el endpoint está protegido con `requireOwner`. La contraseña mínima es de 8 caracteres.

Archivar un usuario revoca sus sesiones y lo oculta de la lista normal. «Mostrar archivados» permite restaurarlo. El flujo no elimina cuentas de forma permanente y protege al propietario actual y la existencia de un propietario activo.

## Agente de presentaciones

En el menú lateral, `Presentaciones IA` está debajo de `Firmas de correo`. También admite el enlace directo `/admin/#presentations`. Crea una presentación a partir de un tema y notas de apoyo, con contenido de `gpt-6.1-sol` y una imagen de portada opcional de `gpt-image-2.5-sunburst`. Las llamadas de texto solicitan `service_tier: "fast"`. El resultado incluye PPTX editable, PDF y PNG por diapositiva, además de la imagen de portada por separado. Los archivos se guardan en `data/<entorno>/generated-presentations` y en App Storage cuando está conectado.

Para activar OpenAI, agrega `OPENAI_API_KEY` en Secrets de Replit y republica. De forma opcional puedes definir `OPENAI_PRESENTATION_MODEL`, `OPENAI_IMAGE_MODEL` y `OPENAI_BASE_URL`. El panel muestra los modelos configurados. Si todavía no hay clave, permite generar un archivo de prueba marcado sin IA. Si la API falla, muestra el error sin sustituir el modelo solicitado por otro ni presentar una plantilla como contenido de IA.

El acceso al agente requiere una sesión del CMS; generar archivos requiere rol `owner` o `editor`. El historial es privado y las descargas pasan por rutas autenticadas. La revisión humana ocurre antes de compartir el PPTX, PDF o las imágenes. Las nuevas presentaciones pueden incluir las imágenes institucionales de apertura y cierre con un interruptor activado por defecto. El número elegido representa contenido y las dos láminas se agregan solo cuando el interruptor está activo.

## Medios

La Biblioteca guarda archivos en `storage/media` y registra una referencia persistente en el CMS. El panel permite reutilizarlos en campos de imagen, video, audio y documentos. En Replit, monta un almacenamiento persistente para esa carpeta antes de publicar.

El puente público carga la configuración desde `/api/cms/public`, aplica los overrides, muestra el aviso de cookies y carga Analytics sólo después de aceptar. El servidor genera `/robots.txt`, `/sitemap.xml` y `/llms.txt`, además de `canonical`, `robots`, `google-site-verification` y JSON-LD `LegalService` con los datos GEO.

## Cambiar a PostgreSQL

Better Auth está encapsulado en `server/auth.mjs`; la instancia actual usa SQLite para que el proyecto funcione sin servicios externos. Si Replit proporciona PostgreSQL, cambia el adaptador de Better Auth por `drizzleAdapter` y conserva las rutas `/api/auth/*`, el contrato de `/api/cms/auth-state` y la matriz de permisos del panel.
