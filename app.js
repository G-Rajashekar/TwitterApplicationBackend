const express = require('express')
const path = require('path')
const dbPath = path.join(__dirname, 'twitterClone.db')
const {open} = require('sqlite')
const sqlite3 = require('sqlite3')
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const app = express()
app.use(express.json())
let db = null

const initializeDBAndServer = async () => {
  try {
    db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    })
    app.listen(3000, () => {
      console.log('Server Running at http://localhost:3000/')
    })
  } catch (e) {
    console.log(`DB Error: ${e.message}`)
    process.exit(1)
  }
}

initializeDBAndServer()

const getFollowingUserId = async userId => {
  const getFollowingUserIdQuery = `select following_user_id
         from follower 
         where follower_user_id='${userId}';`
  const followingPeople = await db.all(getFollowingUserIdQuery)
  const followingIds = followingPeople.map(
    eachUser => eachUser.following_user_id,
  )
  return followingIds
}

const getFollowerId = async userId => {
  const getFollowerUserIdQuery = `select follower_user_id from follower where following_user_id = '${userId}'`
  const followers = await db.all(getFollowerUserIdQuery)
  const followerIds = followers.map(eachUser => eachUser.follower_user_id)
  return followerIds
}

const verifyTwitterAccess = async (request, response, next) => {
  const {userId} = request
  const {tweetId} = request.params
  const verifyTweetQuery = `select * from tweet where user_id in (select following_user_id from follower where follower_user_id='${userId}') AND tweet_id='${tweetId}';`
  const tweet = await db.get(verifyTweetQuery)
  if (tweet === undefined) {
    response.status(401)
    response.send('Invalid Request')
  } else {
    next()
  }
}

const authenticateToken = (request, response, next) => {
  let jwtToken
  const authHeader = request.headers['authorization']
  if (authHeader) {
    jwtToken = authHeader.split(' ')[1]
  }
  if (jwtToken) {
    jwt.verify(jwtToken, 'MY_SECRET_TOKEN', (error, payload) => {
      if (error) {
        response.status(401)
        response.send('Invalid JWT Token')
      } else {
        request.username = payload.username
        request.userId = payload.userId
        next()
      }
    })
  } else {
    response.status(401)
    response.send('Invalid JWT Token')
  }
}

app.post('/register/', async (request, response) => {
  const {username, password, name, gender} = request.body
  const userExistQuery = `select  * from user where username='${username}';`
  const dbUser = await db.get(userExistQuery)
  if (dbUser === undefined) {
    const pwdLength = password.length
    if (pwdLength > 6) {
      const hashPassword = await bcrypt.hash(password, 10)
      const createUser = `
                 insert into user
                  (username,password,name,gender) 
                values('${username}','${hashPassword}','${name}','${gender}');`
      await db.run(createUser)
      response.status(200)
      response.send('User created successfully')
    } else {
      response.status(400)
      response.send('Password is too short')
    }
  } else {
    response.status(400)
    response.send('User already exists')
  }
})

app.post('/login/', async (request, response) => {
  const {username, password} = request.body
  const userVerifyQuery = `select * from user where username='${username}';`
  const dbUser = await db.get(userVerifyQuery)
  if (dbUser !== undefined) {
    const isPwdMatched = await bcrypt.compare(password, dbUser.password)
    if (isPwdMatched === true) {
      const payload = {username: username, userId: dbUser.user_id}
      const jwtToken = jwt.sign(payload, 'MY_SECRET_TOKEN')
      response.send({jwtToken})
    } else {
      response.status(400)
      response.send('Invalid password')
    }
  } else {
    response.status(400)
    response.send('Invalid user')
  }
})

app.get('/user/tweets/feed/', authenticateToken, async (request, response) => {
  const {userId} = request
  const followingIds = await getFollowingUserId(userId)
  const tweetQuery = `select username,tweet,date_time as dateTime
          from user
          inner join tweet on user.user_id =tweet.user_id
          where user.user_id in (${followingIds})
          order by date_time DESC
          limit 4;`
  const tweets = await db.all(tweetQuery)
  response.send(tweets)
})

app.get('/user/following/', authenticateToken, async (request, response) => {
  const {userId} = request
  const followingIds = await getFollowingUserId(userId)
  const getNamesQuery = `select name
       from user
       where user_id in (${followingIds});`
  const names = await db.all(getNamesQuery)
  response.send(names)
})

app.get('/user/followers/', authenticateToken, async (request, response) => {
  const {userId} = request
  const followerIds = await getFollowerId(userId)
  const getNamesQuery = `select  name
       from user
       where user_id in (${followerIds});`
  const followers = await db.all(getNamesQuery)
  response.send(followers)
})

app.get('/tweets/:tweetId/', authenticateToken,
  verifyTwitterAccess,async (request, response) => {
  const {tweetId} = request.params
  const getTweetInfo = `select tweet,count(distinct like_id) as likes,count(distinct reply_id) as replies,date_time as dateTime from tweet left join like on tweet.tweet_id=like.tweet_id 
                            left join reply on tweet.tweet_id=reply.tweet_id where tweet.tweet_id='${tweetId}';`
  const tweet = await db.get(getTweetInfo)
  response.send(tweet)
})

app.get(
  '/tweets/:tweetId/likes/',
  authenticateToken,
  verifyTwitterAccess,
  async (request, response) => {
    const {tweetId} = request.params
    const getLikeQuery = `select username from 
        user
        inner join like on user.user_id=like.user_id
        where like.tweet_id='${tweetId}';`
    const userLikes = await db.all(getLikeQuery)
    const userArray = await userLikes.map(eachUser => eachUser.username)
    response.send({likes: userArray})
  },
)

app.get(
  '/tweets/:tweetId/replies/',
  authenticateToken,
  verifyTwitterAccess,
  async (request, response) => {
    const {tweetId} = request.params
    const getReplyQuery = `select name,reply from 
        user
        inner join reply on user.user_id=reply.user_id
        where reply.tweet_id='${tweetId}';`
    const userReply = await db.all(getReplyQuery)
    response.send({replies: userReply})
  },
)

app.get('/user/tweets/', authenticateToken, async (request, response) => {
  const {userId} = request
  const getTweetInfo = `select tweet,
   count(distinct like_id) as likes,
   count(distinct reply_id) as replies,
   date_time as dateTime
   from tweet left join reply on tweet.tweet_id=reply.tweet_id left join like on tweet.tweet_id=like.tweet_id
   where tweet.user_id='${userId}'
   group by tweet.tweet_id;`
  const tweets = await db.all(getTweetInfo)
  response.send(tweets)
})

app.post('/user/tweets/', authenticateToken, async (request, response) => {
  const {tweet} = request.body
  const userId = parseInt(request.userId)
  const dateTime = new Date().toJSON().substring(0, 19).replace('T', ' ')
  const createTweetQuery = `insert into tweet 
       (tweet,user_id,date_time)
       values('${tweet}','${userId}','${dateTime}');`
  await db.run(createTweetQuery)
  response.send('Created a Tweet')
})

app.delete(
  '/tweets/:tweetId/',
  authenticateToken,
  async (request, response) => {
    const {userId} = request
    const {tweetId} = request.params
    const getTweetQuery = `select *
       from tweet where tweet_id='${tweetId}' and user_id='${userId}';`
    const tweet = await db.get(getTweetQuery)
    if (tweet === undefined) {
      response.status(401)
      response.send('Invalid Request')
    } else {
      const deleteQuery = `delete from tweet where tweet_id=${tweetId};`
      await db.run(deleteQuery)
      response.send('Tweet Removed')
    }
  },
)

module.exports = app
