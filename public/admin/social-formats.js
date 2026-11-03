// Shared by the renderer and CMS. Keep the original four IDs for saved designs.
export const SOCIAL_FORMATS = {
  portrait: { label:'Vertical 4:5', dimensions:[1080,1350], recommended:'Instagram y Facebook · publicaciones y carruseles', note:'Buen equilibrio entre espacio para el contenido y lectura en el feed.' },
  square: { label:'Cuadrado 1:1', dimensions:[1080,1080], recommended:'Instagram, Facebook y LinkedIn · publicaciones', note:'Una pieza versátil para compartir en varias redes.' },
  story: { label:'Vertical 9:16', dimensions:[1080,1920], recommended:'Instagram y Facebook · historias; TikTok · carrusel de fotos', note:'Texto y logotipo dentro de márgenes amplios para dejar espacio a los controles de la aplicación.', safeArea:{top:160,bottom:250} },
  landscape: { label:'Horizontal 1.91:1', dimensions:[1080,566], recommended:'Instagram y Facebook · publicaciones horizontales', note:'Funciona mejor con un título breve y una sola idea.' },
  'linkedin-square': { label:'LinkedIn cuadrado 1:1', dimensions:[1200,1200], recommended:'LinkedIn · publicaciones y anuncios de imagen', note:'El formato cuadrado se adapta a la visualización en móvil y escritorio.' },
  linkedin: { label:'LinkedIn horizontal 1.91:1', dimensions:[1200,628], recommended:'LinkedIn · publicaciones y anuncios de imagen', note:'Una composición compacta para un mensaje corto.' },
  pinterest: { label:'Pinterest vertical 2:3', dimensions:[1000,1500], recommended:'Pinterest · pines de imagen', note:'La proporción 2:3 es la recomendación de Pinterest para pines de imagen.' },
  youtube: { label:'YouTube HD 16:9', dimensions:[1280,720], recommended:'YouTube · miniatura de video', note:'Una alternativa ligera. Para mayor resolución elige la opción 4K.' },
  'youtube-4k': { label:'YouTube 4K 16:9', dimensions:[3840,2160], recommended:'YouTube · miniatura de video en alta resolución', note:'Resolución recomendada actualmente por YouTube. Mantén el título corto y legible.' }
};
export const SOCIAL_SIZES = Object.fromEntries(Object.entries(SOCIAL_FORMATS).map(([id,format])=>[id,format.dimensions]));
export const SOCIAL_SIZE_LABELS = Object.fromEntries(Object.entries(SOCIAL_FORMATS).map(([id,format])=>[id,format.label]));
export function socialFormatBrief(id) {
  const format=SOCIAL_FORMATS[id]||SOCIAL_FORMATS.portrait;
  const [width,height]=format.dimensions;
  return `${format.label}, ${width} × ${height} pixels. Intended placement: ${format.recommended}. ${width>height?'Use very little text: headline under 45 characters, body under 90, no bullets.':'Keep the headline concise and the visual message readable on a phone.'} ${format.safeArea?'Important content is placed inside a conservative safe area, away from top and bottom interface controls.':''}`;
}
