// Native file pickers for browsers/paths that use <input type=file>.

function pick(configure: (i: HTMLInputElement) => void): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.style.display = 'none'
    configure(input)
    input.onchange = () => resolve(Array.from(input.files ?? []))
    input.addEventListener('cancel', () => resolve([]))
    document.body.appendChild(input)
    input.click()
    setTimeout(() => input.remove(), 60_000)
  })
}

export const pickImportFolder = () =>
  pick((i) => {
    i.webkitdirectory = true
    i.multiple = true
  })

export const pickImportFile = () =>
  pick((i) => {
    i.accept = '.md,.markdown,.zip'
  })

export const pickMedia = () =>
  pick((i) => {
    i.accept = 'image/*,video/*,.svg'
    i.multiple = true
  })
