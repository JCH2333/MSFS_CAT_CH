export function createRecognitionDescriptors(patches) {
  if (!Array.isArray(patches)) return []

  return patches.map((patch) => ({
    id: typeof patch?.id === 'string' ? patch.id : '',
    name: typeof patch?.name === 'string' ? patch.name : '',
    version: typeof patch?.version === 'string' ? patch.version : '',
    targetKind: typeof patch?.targetKind === 'string' ? patch.targetKind : 'addon',
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
    targetKind: typeof patch?.targetKind === 'string' ? patch.targetKind : 'addon',
    package: {
      downloadUrl: typeof patch?.package?.downloadUrl === 'string' ? patch.package.downloadUrl : '',
      githubDownloadUrl: typeof patch?.package?.githubDownloadUrl === 'string' ? patch.package.githubDownloadUrl : '',
      sha256: typeof patch?.package?.sha256 === 'string' ? patch.package.sha256 : '',
      contentRoot: typeof patch?.package?.contentRoot === 'string' ? patch.package.contentRoot : '',
      giteeParts: Array.isArray(patch?.package?.giteeParts)
        ? patch.package.giteeParts.map((part) => ({
            assetName: typeof part?.assetName === 'string' ? part.assetName : '',
            downloadUrl: typeof part?.downloadUrl === 'string' ? part.downloadUrl : '',
            sha256: typeof part?.sha256 === 'string' ? part.sha256 : '',
            size: Number.isSafeInteger(part?.size) ? part.size : 0
          }))
        : []
    }
  }
}
