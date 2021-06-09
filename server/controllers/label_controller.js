const path = require("path");
const Label = require("../models/label_model");
const utils = require("../../util/util");

async function localizeObjects (req) {
  // Imports the Google Cloud client library
  const vision = require("@google-cloud/vision");

  // Creates a client
  // Instantiates a client. If you don't specify credentials when constructing
  // the client, the client library will look for credentials in the
  // environment.
  try {
    const client = new vision.ImageAnnotatorClient({
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS
    });

    const bufferData = await utils.getS3BufferData(req.file);

    const request = {
      image: { content: bufferData }
    };

    // const s3Uri = "s3://" + req.file.bucket + "/" + req.file.key;
    // console.log(s3Uri);
    const [result] = await client.objectLocalization(request);
    // console.log(result);
    // 先不要寫檔，怕速度太慢
    // const filePath = path.join(__dirname, `../../label_json/api_inference/prediction_${req.file.originalname.split(".")[0]}.json`);
    // console.log(filePath);
    // utils.writePredictions(result, filePath);

    const objects = result.localizedObjectAnnotations;
    // console.log(objects);
    // objects.forEach(object => {
    //   console.log(`Name: ${object.name}`);
    //   console.log(`Confidence: ${object.score}`);
    //   const vertices = object.boundingPoly.normalizedVertices;
    //   vertices.forEach(v => console.log(`x: ${v.x}, y:${v.y}`));
    // });
    return objects;
  } catch (err) {
    console.log("inside func localizeObjects:");
    console.log(err.stack);
    return err;
  }
};

const saveOriImage = async (req, res) => {
  const userId = req.user.id;
  const imgSize = (req.file.size / 1024).toFixed(2); // 原始單位：bytes，先換算成kb
  const imgPath = req.file.location;
  const imgFileName = req.file.originalname;

  console.log("label controller");
  console.log(req.file);
  try {
    const localizedAnnotations = await localizeObjects(req);
    console.log(1);
    const imgResult = await Label.insertOriginalImage(userId, imgSize, imgFileName, imgPath);
    console.log(imgResult);
    const imageId = imgResult.imageId;
    const apiResult = Label.insertApiCoordinates(imageId, localizedAnnotations); // let it store to db async

    if (imgResult.result.changedRows === 1) {
      res.status(200).json({ userId, imgSize, imgPath, inference: localizedAnnotations });
    }
  } catch (err) {
    console.log("inside controller saveImg:");
    console.log(err.stack);
    res.status(500).send("Internal Server Error...");
  }
};

const compareLabelsPair = (beforeLabels, afterLabels) => {
  const checkedLabelsArr = [];
  afterLabels.forEach(afterObj => {
    if (afterObj.labelId.toString().includes("fresh")) {
      checkedLabelsArr.push(afterObj);
    } else {
      beforeLabels.forEach(beforeObj => {
        if (afterObj.labelId === beforeObj.id) { // 如果before本來的圖片沒標注，labels = [{owner, msg}]，可能有err
          if (afterObj.x === beforeObj.coordinates_xy.x && afterObj.y === beforeObj.coordinates_xy.y && afterObj.width === beforeObj.coordinates_wh.x && afterObj.height === beforeObj.coordinates_wh.y) {
            console.log("remove duplicated coordinate");
          } else {
            checkedLabelsArr.push(afterObj);
          }
        }
      });
    }
  });
  // console.log("----");
  // console.log(checkedLabelsArr);
  return checkedLabelsArr;
};

const saveCoordinates = async (req, res) => {
  const userId = req.user.id;
  // console.log(req.body);

  const originalLabels = req.body.before;
  const newLabels = req.body.after;
  let checkedLabels;
  console.log(originalLabels === newLabels);

  try {
    if (originalLabels === newLabels) {
      console.log("condition 0");
      res.status(200).send({ msg: "Nothing new to submit" });
      return;
    } else if (originalLabels && originalLabels[0].id) { // condition: old img w labels
      console.log("condition 1");
      checkedLabels = compareLabelsPair(originalLabels, newLabels);
    } else if (originalLabels && !originalLabels[0].id) { // condition: old img w/o labels
      console.log("condition 2");
      checkedLabels = newLabels;
    } else if (originalLabels === undefined) { // condition: new upload img
      console.log("condition 3");
      checkedLabels = newLabels;
    }

    if (checkedLabels.length === 0) {
      console.log("condition 4");
      res.status(200).send({ msg: "Nothing new to submit" });
    } else {
      const result = await Label.insertCoordinates(userId, checkedLabels);
      console.log(result.msg);
      if (result.msg) {
        res.status(200).send({ labeler: userId, msg: result.msg, checkedLabels });
      }
    }
  } catch (err) {
    console.log(err);
    res.status(500).send("Internal Server Error...");
  }
};

const loadLabels = async (req, res) => {
  console.log("controller");
  console.log(req.query);
  // const userId = req.query.user;
  const imgId = req.query.img;
  const result = await Label.queryLabels(imgId);
  // console.log(result);
  if (result.length > 0) {
    res.status(200).send(result);
  } else {
    // result = []
    const imgOwner = await Label.queryImageOwner(imgId);
    res.status(200).send([{ owner: imgOwner.owner, msg: "Label not found" }]);
  }
};

module.exports = {
  saveOriImage,
  saveCoordinates,
  loadLabels
};
