function createDesktopPauseOwnership() {
  let pausedOwnerId = null

  return {
    armForExternalBlur(snapshot) {
      const ownerSessionId = snapshot?.ownerSessionId
      pausedOwnerId =
        snapshot?.mode === 'study'
        && snapshot?.status === 'running'
        && typeof ownerSessionId === 'string'
        && ownerSessionId
          ? ownerSessionId
          : null
      return pausedOwnerId
    },

    observeSnapshot(snapshot) {
      if (
        pausedOwnerId
        && (
          snapshot?.mode !== 'study'
          || snapshot?.ownerSessionId !== pausedOwnerId
          || snapshot?.status === 'idle'
          || snapshot?.status === 'completed'
        )
      ) {
        pausedOwnerId = null
      }
    },

    clearForCommand(command) {
      if (command?.type === 'pause' || command?.type === 'resume' || command?.type === 'startStudy') {
        pausedOwnerId = null
      }
    },

    consumeResume(snapshot) {
      const resumeOwnerId = pausedOwnerId
      pausedOwnerId = null
      if (
        resumeOwnerId
        && snapshot?.mode === 'study'
        && snapshot?.status === 'paused'
        && snapshot?.ownerSessionId === resumeOwnerId
      ) {
        return resumeOwnerId
      }
      return null
    },

    clear() {
      pausedOwnerId = null
    },
  }
}

module.exports = { createDesktopPauseOwnership }
