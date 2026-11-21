export type ViewKind = 'hangul' | 'text' | 'csv' | 'word' | 'sheet' | 'slides' | 'pdf' | 'image' | 'preview' | 'pending';

export interface Format {
  extension: string;
  group: string;
  kind: ViewKind;
  editable: boolean;
}

const registry = new Map<string, Format>();

function register(extensions: string, group: string, kind: ViewKind, editable = false) {
  for (const extension of extensions.split(' ')) registry.set(extension, { extension, group, kind, editable });
}

register('hwp hwpx hwt owpml', '한글 문서', 'hangul', true);
register('docx', '문서', 'word', true);
register('docm dotx dotm', '문서', 'word');
register('doc dot odt ott fodt rtf pages wps wpd sxw stw', '문서', 'preview');
register('pptx', '프레젠테이션', 'slides', true);
register('pptm ppsx ppsm potx potm', '프레젠테이션', 'slides');
register('ppt pps pot odp otp fodp key sxi sti', '프레젠테이션', 'preview');
register('xlsx', '스프레드시트', 'sheet', true);
register('xlsm xltx xltm', '스프레드시트', 'sheet');
register('xls xlsb xlt ods ots fods numbers dif slk sxc stc et ett wk1 wk3 wk4 wks', '스프레드시트', 'preview');
register('csv tsv', '스프레드시트', 'csv', true);
register('txt tex latex typ md markdown mdx rst adoc asciidoc org textile wiki', '텍스트', 'text', true);
register('html htm xhtml css scss less xml xsl xslt xsd dtd svg json jsonl ndjson json5 yaml yml toml ini cfg conf properties env sql', '웹·설정', 'text', true);
register('log nfo url', '텍스트', 'text');
register('py pyw js mjs cjs ts tsx jsx java kt kts swift c h cpp cc hpp cs go rs rb php sh bash zsh fish ps1 bat cmd vue svelte astro dart lua pl pm r rmd qmd jl scala sc', '코드', 'text', true);
register('graphml gv mermaid mmd', '다이어그램', 'text', true);
register('excalidraw', '다이어그램', 'text', true);
register('drawio dio', '다이어그램', 'preview');
register('db sqlite sqlite3 db3 accdb mdb dbf parquet arrow feather avro orc h5 hdf5 mat sav dta sas7bdat', '데이터', 'preview');
register('pdf', '페이지 문서', 'pdf');
register('jpg jpeg png apng gif webp avif bmp tif tiff heic heif ico jfif jp2 j2k jxl tga psd psb ai eps cdr afdesign afphoto sketch fig xd indd idml pub vsd vsdx', '이미지·디자인', 'image');
register('xps oxps djvu djv epub fb2 mobi azw azw3 kfx lit lrf lrx pdb prc chm ibooks cbz cbr cb7 cbt', '전자책·페이지 문서', 'preview');
register('eml msg ics ical vcf one enex opml ipynb mhtml mht webloc p7m p7s sig asc pem crt cer der p12 pfx', '기타 문서', 'preview');
register('gdoc gsheet gslides gdraw gform gsite', 'Google Drive', 'pending');

export const formats = [...registry.values()];
export const extensionOf = (name: string) => name.split('.').slice(1).at(-1)?.toLowerCase() ?? '';
export const detectFormat = (name: string): Format => {
  const extension = extensionOf(name);
  return registry.get(extension) ?? { extension, kind: 'pending', group: '기타', editable: false };
};

export function replaceExtension(name: string, extension: string) {
  const dot = name.lastIndexOf('.');
  return `${dot > 0 ? name.slice(0, dot) : name}.${extension}`;
}
