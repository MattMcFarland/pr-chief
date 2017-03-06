const { prompt } = require('inquirer')
const { resolve: resolvePath } = require('path')
const gitConfig = require('git-config')
const spawn = require('cross-spawn')
const GithubApi = require('./GithubApi')

const store = {}

getConfig()
  .then(config => addToStore('config', config))
  .then(plog)
  .then(getCredentials)
  .then(configureApi)
  .then(github => addToStore('github', github))
  .then(processPullRequests)
  .catch(console.error)

function processPullRequests (github) {
  getPullRequests(github)
  .then(abortIfNoPullRequests)
  .then(showPullRequestMenu)
  .then(abortOnCancel)
  .then(selectPullRequest)
  .then(clonePullRequest)
  .then(prData => addToStore('prData', prData))
  .then(installDependencies)
  .then(runTests)
  .then(askForMerge)
  .then(mergeIfYes)
  .then(() => processPullRequests(github))
  .catch(console.error)
}

function getConfig () {
  const configPath = resolvePath(process.cwd(), '.git/config')
  return new Promise((resolve, reject) =>
    gitConfig(configPath, (err, res) => {
      if (err) {
        reject(err)
      } else {
        resolve(res)
      }
    }
  ))
}

function getCredentials () {
  const loginForm = [{
    name: 'user',
    type: 'input',
    message: 'Github username'
  }, {
    name: 'pass',
    type: 'password',
    message: 'Password'
  }]
  return prompt(loginForm)
}

function configureApi ({user, pass}) {
  return Promise.resolve(GithubApi({
    auth: `${user}:${pass}`,
    headers: { 'User-Agent': 'Matt McFarland <contact@mattmcfarland.com>' }
  }))
}

function getPullRequests (github) {
  return github.get(`/repos/${pkg.repository.url}/pulls`)
}

function abortIfNoPullRequests (pullRequests) {
  if (!Array.isArray(pullRequests)) {
    console.log('No pull requests found. Aborted')
    process.exit(0)
  }
  return Promise.resolve(pullRequests)
}

function showPullRequestMenu (pullRequests) {
  const choices = pullRequests.map((pr, index) => ({
    name: `(${pr.number}) ${pr.user.login}: "${pr.title}"`,
    short: pr.title,
    value: index
  }))
  choices.push({
    name: 'cancel',
    value: -1
  })
  return prompt([{
    name: 'requestSelection',
    type: 'list',
    message: 'Select a pull request',
    choices,
    filter: (val) => pullRequests[val] || val
  }])
}

function abortOnCancel (answers) {
  if (answers.requestSelection === -1) {
    console.log('cancelled.')
    process.exit(0)
  }
  return answers
}

function selectPullRequest (requestMenu) {
  return Promise.resolve(requestMenu.requestSelection)
}

function clonePullRequest (pullRequest) {
  return new Promise((resolve, reject) => {
    const pathName = `pull-requests/${pullRequest.number}`
    const clonePath = resolvePath(process.cwd(), pathName)
    const branchName = pullRequest.head.ref
    console.log(`Cloning ${pullRequest.title} from ${pullRequest.head.ref} to ${clonePath}`)
    spawn('git', ['clone', pullRequest.head.repo.clone_url, '-b', branchName, clonePath], {stdio: 'inherit'})
      .on('close', code => !code ? resolve({pullRequest, clonePath, branchName}) : reject({message: 'An error occurred', code}))
  })
}

function installDependencies (clonePath) {
  return new Promise((resolve, reject) => {
    spawn('npm', ['install'], { cwd: clonePath, stdio: 'inherit' })
      .on('close', code => !code ? resolve(clonePath) : reject({message: 'An error occurred', code}))
  })
}

function runTests (clonePath) {
  return new Promise((resolve, reject) => {
    spawn('npm', ['test'], { cwd: clonePath, stdio: 'inherit' })
      .on('close', code => !code ? resolve(true) : reject({message: 'An error occurred', code}))
  })
}

function askForMerge () {
  return prompt([{
    type: 'confirm',
    name: 'performMerge',
    message: 'Would you like to merge now?',
    default: false
  }])
}

function mergeIfYes ({performMerge}) {
  if (!performMerge) {
    return Promise.resolve(false)
  }
  const owner = store.prData.pullRequest.head.repo.owner.login
  const repo = store.prData.pullRequest.head.repo.name
  const number = store.prData.pullRequest.number
  return store.github.put(`/repos/${owner}/${repo}/pulls/${number}/merge`)
}

function plog (promiseObject) {
  console.log(promiseObject)
  return promiseObject
}

function addToStore (key, promisedObject) {
  store[key] = promisedObject
  return Promise.resolve(promisedObject)
}
