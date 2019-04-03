const db = require('./db')
const { sendAsBot } = require('./bot')
const { getURL } = require('./')

const GITHUB_EVENT_HEADER_KEY = 'X-GitHub-Event'

const GITHUB_EVENT_TYPES = {
  PING: 'ping',
  PULL_REQUEST: 'pull_request',
  PULL_REQUEST_REVIEW: 'pull_request_review',
}

const GITHUB_EVENT_ACTION_TYPES = {
  REVIEW_REQUESTED: 'review_requested',
  SUBMITTED: 'submitted',
}

const getHeader = (req, key) => req.headers && (req.headers[key] || req.headers[key.toLowerCase()])

const getWorkspace = (req, data) => {
  const url = getURL(req)
  const workspace = url.searchParams.get('workspace')
  if (!workspace) throw Error(`no workspace provided`)
  return workspace
}

exports.handleGitHubHook = (req, data) => {
  // handle application/x-www-form-urlencoded data
  if (data.payload) data = JSON.parse(data.payload)

  const workspace = getWorkspace(req, data)
  const type = getHeader(req, GITHUB_EVENT_HEADER_KEY)
  switch (type) {
    case GITHUB_EVENT_TYPES.PING:
      return `I'm ready!`
    case GITHUB_EVENT_TYPES.PULL_REQUEST:
      if (data['action'] === GITHUB_EVENT_ACTION_TYPES.REVIEW_REQUESTED) {
        const pullRequest = data['pull_request']
        const requestedReviewer = data['requested_reviewer']
        const {
          user: { login: requesterGitHubName },
          html_url: pullRequestURL,
        } = pullRequest
        const { login: reviewerGitHubName } = requestedReviewer
        return Promise.all([
          db.loadWorkspace(workspace),
          ...[requesterGitHubName, reviewerGitHubName].map(githubName =>
            db.loadLinks(workspace, { githubName }).then(links => (links ? links[0].slack : null))
          ),
        ]).then(([{ botToken }, requesterUserID, reviewerUserID]) => {
          if (reviewerUserID && requesterUserID) {
            // both registered
            const text = `${requesterGitHubName}(<@${requesterUserID}>) requested code review from ${reviewerGitHubName}(<@${reviewerUserID}>):\n${pullRequestURL}`
            return Promise.all([
              sendAsBot(botToken, requesterUserID, text),
              sendAsBot(botToken, reviewerUserID, text),
            ])
          } else if (reviewerUserID) {
            // only reviewer registered
            let text = `${requesterGitHubName}(<@${requesterUserID}>) requested code review from ${reviewerGitHubName}(<@${reviewerUserID}>):\n${pullRequestURL}\n\nPS: ${requesterGitHubName} has not been linked yet. If he/she is in this Slack workspace, please introduce this app to!`
            return sendAsBot(botToken, reviewerUserID, text)
          } else if (requesterUserID) {
            // only requestor registered
            let text = `${requesterGitHubName}(<@${requesterUserID}>) requested code review from ${reviewerGitHubName}(<@${reviewerUserID}>):\n${pullRequestURL}\n\nPS: ${reviewerGitHubName} has not been linked yet. If he/she is in this Slack workspace, please introduce this app to!`
            return sendAsBot(botToken, requesterUserID, text)
          } else {
            console.log(`could not find users for`, requesterGitHubName, `and`, reviewerGitHubName)
          }
        })
      } else {
        return 'unresolved action'
      }
    case GITHUB_EVENT_TYPES.PULL_REQUEST_REVIEW:
      switch (data.action) {
        case GITHUB_EVENT_ACTION_TYPES.SUBMITTED:
          const {
            pull_request: {
              user: { login: requesterGitHubName },
            },
            review: {
              html_url: reviewUrl,
              user: { login: reviewerGitHubName },
            },
          } = data
          if (requesterGitHubName === reviewerGitHubName) return
          return Promise.all([
            db.loadWorkspace(workspace),
            ...[requesterGitHubName, reviewerGitHubName].map(githubName =>
              db.loadLinks(workspace, { githubName }).then(links => (links ? links[0].slack : null))
            ),
          ]).then(([{ botToken }, requesterUserID, reviewerUserID]) => {
            const text = `${requesterGitHubName}(<@${requesterUserID}>)'s PR is code reviewed by ${reviewerGitHubName}(<@${reviewerUserID}>):\n${reviewUrl}`
            const linkNotify = githubName => `\n\nPS: ${gitHubName} has not been linked yet. If he/she is in this Slack workspace, please introduce this app to!`
            if (requesterUserID && reviewerUserID) {
              return Promise.all([
                sendAsBot(botToken, requesterUserID, text),
                sendAsBot(botToken, reviewerUserID, text),
              ])
            } else if (requesterUserID) {
              return sendAsBot(botToken, requesterUserID, text + linkNotify(reviewerGitHubName))
            } else if (reviewerUserID) {
              return sendAsBot(botToken, reviewerUserID, text + linkNotify(requesterGitHubName))
            } else {
              return (`Could not find users for ${requesterGitHubName} and ${reviewerGitHubName}`)
            }
          })
        default:
          return 'unresolved action'
      }
    default:
      if (!type) throw Error(`no github event header provided`)
      return `no handler for this event type`
  }
}
