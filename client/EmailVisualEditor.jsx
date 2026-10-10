/** GrapesJS newsletter editor used by the email templates panel. */
import { useEffect, useRef } from 'react';
import grapesjs from 'grapesjs';
import presetNewsletter from 'grapesjs-preset-newsletter';
import 'grapesjs/dist/css/grapes.min.css';
import './email-editor.css';
const BLOCK_LABELS = {
    sect100: 'Rad 100%',
    sect50: 'Rad 50 / 50',
    sect30: 'Rad 3 kolonner',
    sect37: 'Rad 30 / 70',
    button: 'Knapp',
    divider: 'Skillelinje',
    text: 'Tekst',
    'text-sect': 'Overskrift + tekst',
    image: 'Bilde',
    quote: 'Sitat',
    'grid-items': 'Rutenett',
    'list-items': 'Liste',
};
function inlinedHtml(editor) {
    try {
        const html = editor.runCommand('gjs-get-inlined-html');
        if (typeof html === 'string' && html.trim())
            return html;
    }
    catch {
        // ignore
    }
    return editor.getHtml();
}
function loadCanvas(editor, html, grapesProject) {
    if (grapesProject && typeof grapesProject === 'object') {
        editor.loadProjectData(grapesProject);
        return;
    }
    editor.setComponents(html || '');
}
/** GrapesJS editor for one email template. */
export function EmailVisualEditor({ html, htmlKey = '', grapesProject, mergeFields = [], onHtmlChange, onProjectChange }) {
    const rootRef = useRef(null);
    const editorRef = useRef(null);
    const onChangeRef = useRef(onHtmlChange);
    const onProjectRef = useRef(onProjectChange);
    onChangeRef.current = onHtmlChange;
    onProjectRef.current = onProjectChange;
    useEffect(() => {
        if (!rootRef.current)
            return undefined;
        const editor = grapesjs.init({
            container: rootRef.current,
            height: '100%',
            fromElement: false,
            storageManager: false,
            noticeOnUnload: false,
            plugins: [(instance) => presetNewsletter(instance, {
                    modalTitleImport: 'Importer HTML',
                    modalTitleExport: 'Eksporter HTML',
                    modalLabelImport: 'Lim inn HTML-mal. Bildelenker bør være absolutte.',
                    modalBtnImport: 'Importer',
                    showBlocksOnLoad: true,
                    showStylesOnChange: true,
                    useCustomTheme: false,
                    textCleanCanvas: 'Tøm hele e-posten?',
                    block: (id) => (BLOCK_LABELS[id] ? { label: BLOCK_LABELS[id] } : {}),
                })],
            deviceManager: {
                devices: [
                    { id: 'desktop', name: 'PC', width: '' },
                    { id: 'mobile', name: 'Telefon', width: '390px', widthMedia: '480px' },
                ],
            },
        });
        editor.BlockManager.add('email-canvas-600', {
            label: 'Bredde 600px',
            category: 'Layout',
            content: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#ffffff;"><tr><td align="center" style="padding:24px 12px;"><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;"><tr><td style="padding:24px;font-family:Arial,Helvetica,sans-serif;color:#111111;font-size:16px;">Dobbeltklikk for å redigere denne teksten.</td></tr></table></td></tr></table>`,
        });
        mergeFields.forEach((field) => {
            editor.BlockManager.add(`merge-${field.token}`, {
                label: field.label,
                category: 'Flettefelt',
                content: `<span data-merge="${field.token}">${field.token}</span>`,
            });
        });
        const emit = () => {
            onChangeRef.current?.(inlinedHtml(editor));
            onProjectRef.current?.(editor.getProjectData());
        };
        editor.on('update', emit);
        editor.on('load', () => {
            loadCanvas(editor, html, grapesProject);
            emit();
        });
        editorRef.current = editor;
        return () => {
            editor.destroy();
            editorRef.current = null;
        };
    }, [htmlKey]);
    function insertToken(token) {
        const editor = editorRef.current;
        if (!editor)
            return;
        try {
            editor.RichTextEditor.insert(token);
        }
        catch {
            editor.addComponents(`<span>${token}</span>`);
        }
    }
    return (<div className="flex flex-col h-full min-h-[620px] gap-3">
      {mergeFields.length > 0 && (<div className="flex flex-wrap gap-1.5">
          {mergeFields.map((field) => (<button key={field.token} type="button" onClick={() => insertToken(field.token)} className="px-2 py-1 rounded-full text-[11px] bg-white/10 hover:bg-[#FF5B00] text-gray-200">
              {field.label}
            </button>))}
        </div>)}
      <div ref={rootRef} className="email-gjs flex-1"/>
      <p className="text-[11px] text-gray-500">Dra blokker, flytt seksjoner, og klikk tekst for å redigere. Bytt PC/telefon øverst i editoren.</p>
    </div>);
}
