export function createRecognitionDescriptors(patches) {
  if (!Array.isArray(patches)) return []

  return patches.map((patch) => ({
    id: typeof patch?.id === 'string' ? patch.id : '',
    name: typeof patch?.name === 'string' ? patch.name : '',
    version: typeof patch?.version === 'string' ? patch.version : '',
    fingerprint: Array.isArray(patch?.fingerprint)
      ? patch.fingerprint.map((file) => ({
        relativePath: typeof file?.relativePath === 'string' ? file.relativePath : '',
        sha256: typeof file?.sha256 === 'string' ? file.sha256 : ''
      }))
      : []
  }))
}

export function createInstallationRequest(patch) {
  return {
    ...createRecognitionDescriptors([patch])[0],
    status: typeof patch?.status === 'string' ? patch.status : '',
    package: {
      downloadUrl: typeof patch?.package?.downloadUrl === 'string' ? patch.package.downloadUrl : '',
      sha256: typeof patch?.package?.sha256 === 'string' ? patch.package.sha256 : '',
      contentRoot: typeof patch?.package?.contentRoot === 'string' ? patch.package.contentRoot : ''
    }
  }
}
