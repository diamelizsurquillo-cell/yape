import React from 'react';
import { X, Download, Smartphone, Monitor, CheckCircle, Share } from 'lucide-react';

export default function PwaInstallModal({
  open,
  onClose,
  platform,
  canPromptNative,
  onTriggerNativeInstall
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl border border-gray-100 max-h-[90dvh] flex flex-col overflow-hidden">
        {/* Cabecera fija */}
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0 bg-gradient-to-r from-yape to-yape-dark text-white">
          <div className="flex items-center gap-3">
            <img
              src="/pwa-192x192.png"
              alt="Yape Monitor"
              className="w-10 h-10 rounded-xl border border-white/25 shadow-md bg-white/10"
            />
            <div>
              <h3 className="text-sm sm:text-base font-extrabold leading-tight">
                Instalar Yape Monitor (Opcional)
              </h3>
              <p className="text-[11px] text-white/80">
                Acceso directo en pantalla sin barras del navegador
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/80 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Contenido adaptable según sistema operativo */}
        <div className="p-5 overflow-y-auto modal-scroll flex-1 space-y-4 text-sm text-gray-700 pb-safe">
          <div className="grid grid-cols-1 gap-2 bg-purple-50/70 border border-purple-100 rounded-xl p-3 text-xs text-purple-950">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>Abre directo desde tu Escritorio o Pantalla de Inicio</span>
            </div>
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>Ventana independiente ideal para Caja / Mostrador</span>
            </div>
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>100% opcional — también puedes seguir usándolo en la web</span>
            </div>
          </div>

          {canPromptNative ? (
            <div className="space-y-3">
              <p className="text-xs text-gray-600 text-center">
                Tu navegador soporta instalación directa en 1 clic:
              </p>
              <button
                type="button"
                onClick={async () => {
                  await onTriggerNativeInstall();
                  onClose();
                }}
                className="w-full bg-yape hover:bg-yape-dark text-white font-extrabold py-3 px-4 rounded-xl shadow-lg flex items-center justify-center gap-2 transition"
              >
                <Download className="w-5 h-5" />
                <span>Instalar Aplicación Ahora</span>
              </button>
            </div>
          ) : platform === 'ios' ? (
            <div className="space-y-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-2 font-extrabold text-gray-900 text-xs uppercase">
                <Smartphone className="w-4 h-4 text-yape" />
                <span>Pasos en iPhone / iPad (Safari)</span>
              </div>
              <ol className="space-y-2.5 text-xs text-gray-700 list-decimal list-inside font-medium">
                <li>
                  Toca el botón <strong>Compartir</strong>{' '}
                  <Share className="w-3.5 h-3.5 inline text-blue-600 mx-0.5" /> en la barra inferior de Safari.
                </li>
                <li>
                  Desliza hacia abajo y elige <strong>&quot;Agregar a inicio&quot;</strong> (Add to Home Screen).
                </li>
                <li>
                  Toca <strong>&quot;Agregar&quot;</strong> arriba a la derecha. ¡Listo!
                </li>
              </ol>
            </div>
          ) : platform === 'android' ? (
            <div className="space-y-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-2 font-extrabold text-gray-900 text-xs uppercase">
                <Smartphone className="w-4 h-4 text-yape" />
                <span>Pasos en Celular / Tablet Android</span>
              </div>
              <ol className="space-y-2 text-xs text-gray-700 list-decimal list-inside font-medium">
                <li>
                  Toca el menú de tres puntos <strong>(⋮)</strong> arriba a la derecha en Chrome.
                </li>
                <li>
                  Selecciona <strong>&quot;Instalar aplicación&quot;</strong> o{' '}
                  <strong>&quot;Agregar a la pantalla principal&quot;</strong>.
                </li>
                <li>Confirma tocando <strong>Instalar</strong>.</li>
              </ol>
            </div>
          ) : (
            <div className="space-y-3 bg-gray-50 border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-2 font-extrabold text-gray-900 text-xs uppercase">
                <Monitor className="w-4 h-4 text-yape" />
                <span>Pasos en PC / Laptop (Chrome o Edge)</span>
              </div>
              <ol className="space-y-2 text-xs text-gray-700 list-decimal list-inside font-medium">
                <li>
                  En la barra de direcciones arriba a la derecha, haz clic en el ícono de{' '}
                  <strong>Instalar (🖥️⬇)</strong>.
                </li>
                <li>
                  O abre el menú <strong>(⋮)</strong> → <strong>Guardar y compartir</strong> →{' '}
                  <strong>Instalar página como aplicación</strong>.
                </li>
              </ol>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              type="button"
              onClick={onClose}
              className="w-full sm:w-auto bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold py-2.5 px-4 rounded-xl transition"
            >
              Continuar en el navegador
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
