import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * Build and install Mesh's application menu. We deliberately own the
 * accelerators that affect navigation (`CommandOrControl+,` for Settings,
 * `CommandOrControl+W` for Close) so the renderer is the sole arbiter
 * of what each keystroke does in the current screen context — the menu
 * just fires an event over IPC and lets the renderer decide.
 *
 * The standard roles (`copy`, `paste`, `quit`, …) come along so the
 * built-in macOS shortcuts continue to work; we just skip the default
 * `windowMenu` because its bundled `Close Window` accelerator would
 * collide with our `Close` item.
 */
export function buildApplicationMenu(getWindow: () => BrowserWindow | null): void {
  const isMac = process.platform === 'darwin'

  const openSettings = (): void => {
    getWindow()?.webContents.send('menu:open-settings')
  }

  const requestClose = (): void => {
    getWindow()?.webContents.send('menu:close-requested')
  }

  const goBack = (): void => {
    getWindow()?.webContents.send('menu:back')
  }

  const toggleHidden = (): void => {
    getWindow()?.webContents.send('menu:toggle-hidden')
  }

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' as const },
              { type: 'separator' as const },
              {
                label: 'Settings…',
                accelerator: 'CommandOrControl+,',
                click: openSettings
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          } as MenuItemConstructorOptions
        ]
      : []),
    {
      label: 'File',
      submenu: [
        ...(isMac
          ? []
          : [
              {
                label: 'Settings…',
                accelerator: 'CommandOrControl+,',
                click: openSettings
              } as MenuItemConstructorOptions
            ]),
        {
          label: 'Close',
          accelerator: 'CommandOrControl+W',
          click: requestClose
        }
      ]
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        {
          label: 'Back',
          accelerator: 'CommandOrControl+[',
          click: goBack
        },
        {
          label: 'Toggle Hidden Files',
          accelerator: 'CommandOrControl+.',
          click: toggleHidden
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
