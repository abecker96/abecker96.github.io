
//initialize canvas
var canvas = document.getElementById("myCanvas");
var c = canvas.getContext("2d");

//scale canvas to window height
canvas.width  = window.innerWidth;
canvas.height = window.innerHeight;

//method of limiting framerate from
// https://stackoverflow.com/questions/19764018/controlling-fps-with-requestanimationframe
const fps = 59;
var stop = false;
var fpsInterval, startTime, now, then, elapsed;
var mouseInputBox, avoidWallsBox, colorsFlockBox, betterAlignmentSim, betterCohesionSim, betterSeparationSim;
var boids = [];
var alphaValue = 1;

const backgroundColor = '#121212';
const boidColors = [
    '#11AD4F',
    '#4DE7FA',
    '#FA5701',
    '#8F58BE',
    '#0C85FA',
]


function normalize(startPos, endPos) {
    //set at origin
    var x = endPos.x - startPos.x;
    var y = endPos.y - startPos.y;
    //find the length
    var length = Math.sqrt(x*x + y*y);
    //finally normalize
    x = x/length;
    y = y/length;
    return new Vert(x, y);
}

class Vert {
    constructor(x, y) {
        this.x = x;
        this.y = y;
    }
    dist(other) {
        var distX = this.x - other.x;
        var distY = this.y - other.y;
        return Math.sqrt((distX**2) + (distY**2));
    }
}

var origin = new Vert(0,0);
var mousePos = origin;

window.addEventListener('mousemove', e => {
    var rect = canvas.getBoundingClientRect();
    mousePos.x = e.clientX - rect.left,
    mousePos.y = e.clientY - rect.top
});

class Turtle {
    constructor(x, y, angle) {
        this.x = x;
        this.y = y;
        this.angle = angle;
    }

    placeVertex() {
        return new Vert(this.x, this.y);
    }
    turn(delta) {
        this.angle += delta;
        this.angle = this.angle % (2*Math.PI);
    }
    forward(dist) {
        this.x += dist * Math.cos(this.angle);
        this.y += dist * Math.sin(this.angle);
    }
}

class KochSnowflake {
    constructor(xPos, yPos, baseLength, fractalLevel) {
        this.baseLength = baseLength;
        this.turtle = new Turtle(xPos, yPos, 0)

        this.turtle.forward(-1 * baseLength/2)
        this.vertices = [this.turtle.placeVertex()];
        for(let i = 0; i < 3; i++) {
            this.generateVertices(fractalLevel, baseLength);
            this.turtle.turn(4* (Math.PI/3.0));
        }
    }

    generateVertices(currentLevel, sideLength) {
        if(currentLevel <= 0) {
            this.turtle.forward(sideLength);
            this.vertices.push(this.turtle.placeVertex());
            return;
        }
        sideLength = sideLength/3.0;
        this.generateVertices(currentLevel-1, sideLength);
        this.turtle.turn(Math.PI/3.0);
        this.generateVertices(currentLevel-1, sideLength);
        this.turtle.turn(4* (Math.PI/3.0));
        this.generateVertices(currentLevel-1, sideLength);
        this.turtle.turn(Math.PI/3.0);
        this.generateVertices(currentLevel-1, sideLength);

        return;
    }

    draw() {
        c.lineWidth = 1;
        c.strokeStyle = '#EEFFFF';
        c.fillStyle = '#181818';

        c.beginPath();
        c.moveTo(this.vertices[0].x, this.vertices[0].y);
        for(let i = 1; i < this.vertices.length; i++) {
            c.lineTo(this.vertices[i].x, this.vertices[i].y);
        }
        //console.log(this.vertices);
        c.closePath();

        c.stroke();
        c.fill();
    }
}

//General information about boids derived from
//  https://www.red3d.com/cwr/boids/
class Boid {
    constructor(angle, pos, size, avoidance, cohesion, alignment, color, speed, flockRadius) {
        this.angle = angle;
        this.pos = pos;
        this.flockRadius = flockRadius;
        this.moveSpeed = speed;   //TODO play around with these values
        this.sideLength = size / 10.0;      
        this.separation = avoidance;
        this.obstacleAvoidance = this.separation *2;
        this.alignment = alignment;
        this.cohesion = cohesion;
        this.color = color;
    }
    determineFlock(others) {
        var currentFlock = [];
        others.forEach((other, index) => {
            var distX = other.pos.x - this.pos.x;
            var distY = other.pos.y - this.pos.y;
            var dist = Math.sqrt(distX**2 + distY**2);

            if((dist < this.flockRadius) && !(other === this) ) {
                if(colorsFlockBox.checked == false){
                    currentFlock.push(index);
                }
                else if(other.color == this.color) {
                    currentFlock.push(index);
                }
            }
        });
        return currentFlock;
    }
    isLeftOrRight(coords) {
        //determining whether a point is on one side of a vector or the other
        //https://math.stackexchange.com/questions/274712/calculate-on-which-side-of-a-straight-line-is-a-given-point-located
        var nextPos = this.nextPos();
        var Bx = nextPos.x;
        var By = nextPos.y;
        var direction = (coords.x - this.pos.x)*(By - this.pos.y) - (coords.y - this.pos.y)*(Bx - this.pos.x);
        //console.log(direction);   //Debug
        return direction;   //proportional to distance! 100 = far away, 1 = close
    }
    nextPos() {
        var Dx = this.pos.x + this.moveSpeed * Math.cos(this.angle);
        var Dy = this.pos.y + this.moveSpeed * Math.sin(this.angle);
        return new Vert(Dx, Dy);
    }
    changeDirection(desiredDirection, coefficient) {
        this.angle += (desiredDirection - this.angle)*coefficient;
        this.angle %= 2*Math.PI;
    }
    turnLeft(desiredDirection, coefficient) {
        this.angle -= (desiredDirection - this.angle)*coefficient;
        this.angle %= 2*Math.PI;
    }
    turnRight(desiredDirection, coefficient) {
        this.angle += (desiredDirection - this.angle)*coefficient;
        this.angle %= 2*Math.PI;
    }
    separate(others) {
        if(betterSeparationSim.checked == true){
            for(let i = 0; i < others.length; i++) {
                if(!(others[i] === this)) {
                    var urgency = (1/this.pos.dist(others[i].pos))**2;
                    var direction = Math.atan2(others[i].pos.y - this.pos.y, others[i].pos.x - this.pos.x)
                    this.changeDirection(-direction, urgency*this.separation);
                }
            }
        } else {
            for(let i = 0; i < others.length; i++) {
                if(!(others[i] === this)) {
                    var urgency = (1/this.pos.dist(others[i].pos))**2;
                    var direction = Math.sign(this.isLeftOrRight(others[i].pos));
                    this.angle += urgency * direction * this.separation;
                }
            }
        }

        //avoid mouse as well
        if(mouseInputBox.checked == true) {
            var urgency = (1/this.pos.dist(mousePos))**2;
            var direction = Math.sign(this.isLeftOrRight(mousePos));
            this.angle += urgency * direction * 100;
        }
    }
    align(flock, others) {
        if(betterAlignmentSim.checked == true) {
            //To get the average angle of a boid's flock, can't just average
            //Need to generate a vector of normal length for every boid, then average those vectors
            var totalX = 0;
            var totalY = 0.01;
            for(let i = 0; i < flock.length; i++) {
                var normalVector = normalize(others[flock[i]].pos, others[flock[i]].nextPos());

                totalX += normalVector.x;
                totalY += normalVector.y;
            }
            var averageVector = new Vert(totalX/flock.length, totalY/flock.length);

            var direction = Math.atan2(averageVector.y, averageVector.x);

            this.changeDirection(direction, this.alignment);
        } else {
            //To get the average angle of a boid's flock, can't just average
            //Need to generate a vector of normal length for every boid, then average those vectors
            var totalX = 0;
            var totalY = 0;
            for(let i = 0; i < flock.length; i++) {
                var boidVector = normalize(this.pos, others[flock[i]].nextPos());

                totalX += boidVector.x;
                totalY += boidVector.y;
            }
            var averageVector = new Vert(totalX/flock.length, totalY/flock.length);

            if(this.isLeftOrRight(averageVector) < 0) {
                //I would like to just add this.
                //In theory, I should be able to just add this.
                //I don't have time to figure out why I can't just add this right now.
                //This works though
                this.angle -= this.alignment;
            }
        }
    }
    cohere(flock, others) {
        if(betterCohesionSim.checked == true) {
            var avgPos;
            var totalPosX = 0;
            var totalPosY = 0;
            for(let i = 0; i < flock.length; i++) {
                totalPosX += others[flock[i]].pos.x;
                totalPosY += others[flock[i]].pos.y;
            }
            avgPos = new Vert(totalPosX/flock.length, totalPosY/flock.length);
            var direction = Math.atan2(avgPos.y - this.pos.y, avgPos.x - this.pos.x);

            //this.changeDirection(direction, this.cohesion);
            var urgency = this.pos.dist(avgPos)^2;
            this.changeDirection(direction, urgency*this.cohesion);
        } else {
            var avgPos;
            var totalPosX = 0;
            var totalPosY = 0;
            for(let i = 0; i < flock.length; i++) {
                totalPosX += others[flock[i]].pos.x;
                totalPosY += others[flock[i]].pos.y;
            }
            var avgPos = new Vert(totalPosX/flock.length, totalPosY/flock.length);

            if(this.isLeftOrRight(avgPos) < 0) {
                this.angle += this.cohesion;
            }
        }
    }
    avoidWalls() {
        var next = this.nextPos();
        var facingRight = Math.sign(next.x - this.pos.x);
        var facingUp = -1*Math.sign(next.y - this.pos.y);
        var rightWall = false;
        var leftWall = false;
        var topWall = false;
        var bottomWall = false;
        var verticalUrgency = 0;
        var horizontalUrgency = 0;
        if(this.pos.x > canvas.width/2) {   
            //consider collision with right wall
            rightWall = true;
            horizontalUrgency = 1/(this.pos.x - canvas.width)**2;
        }
        else{
            //consider collision with left wall
            leftWall = true;
            horizontalUrgency = 1/(this.pos.x**2);
        }
        if(this.pos.y > canvas.width/2) {
            //consider collision with bottom wall
            bottomWall = true;
            verticalUrgency = 1/(this.pos.y - canvas.height)**2;
        }
        else{
            //consider collision with top wall
            topWall = true;
            verticalUrgency = 1/(this.pos.y**2);
        }

        horizontalUrgency *= 100;
        verticalUrgency *= 100;
        if(topWall){
            if(facingRight > 0) {
                this.turnRight(Math.PI/2, verticalUrgency);
            } else {
                this.turnLeft(Math.PI/2, verticalUrgency);
            }
        } else if(bottomWall){
            if(facingRight > 0) {
                this.turnLeft(3*Math.PI/2, verticalUrgency);
            } else {
                this.turnRight(3*Math.PI/2, verticalUrgency);
            }
        }
        if(leftWall){
            if(facingUp > 0) {
                this.turnRight(0, horizontalUrgency);
            } else {
                this.turnLeft(0, horizontalUrgency);
            }
        } else if(rightWall) {
            if(facingUp > 0) {
                this.turnLeft(Math.PI, horizontalUrgency);
            } else {
                this.turnRight(Math.PI, horizontalUrgency);
            }
        }
        //this.angle += horizontalDirection * horizontalUrgency*100;
    }
    move() {
        this.pos.x += this.moveSpeed * Math.cos(this.angle);
        this.pos.y += this.moveSpeed * Math.sin(this.angle);

        if(this.pos.x <= -this.sideLength) {
            this.pos.x += canvas.width;
        }
        if(this.pos.y <= -this.sideLength) {
            this.pos.y += canvas.height;
        }
        this.pos.x %= (canvas.width + this.sideLength);
        this.pos.y %= (canvas.height + this.sideLength);

        //this.angle = 0;
        //console.log(this.pos);    //Debug
    }
    update(others) {
        var flock = this.determineFlock(others);
        if(flock.length > 0) {
            this.align(flock, others);
            this.cohere(flock, others);
        }
        this.separate(others);
        if(avoidWallsBox.checked == true) {
            this.avoidWalls();
        }
        this.move();
    }
    draw() {
        //find the other to vertices
        var p2x = this.pos.x - Math.cos(this.angle + Math.PI/12)*this.sideLength;
        var p2y = this.pos.y - Math.sin(this.angle + Math.PI/12)*this.sideLength;

        var p3x = this.pos.x - Math.cos(this.angle - Math.PI/12)*this.sideLength;
        var p3y = this.pos.y - Math.sin(this.angle - Math.PI/12)*this.sideLength;

        c.beginPath();
        c.moveTo(this.pos.x, this.pos.y);
        c.lineTo(p2x, p2y);
        c.lineTo(p3x, p3y);
        c.closePath();

        c.lineWidth = 1;
        c.strokeStyle = boidColors[this.color];
        c.stroke();

        c.save();
        c.fillStyle = boidColors[this.color];
        c.globalAlpha = 0.5;
        c.fill();
        c.restore();
    }
}

function drawAll(snowflake, boids) {
    snowflake.draw();

    boids.forEach(boid =>{
         boid.update(boids);
         boid.draw();
    });
}

var snowflake = new KochSnowflake(canvas.width/2, canvas.height/2, canvas.height/4, 5);



function startDrawLoop() {
    fpsInterval = 1000/fps;
    then = Date.now();
    drawLoop();
}

function drawLoop() {
    if(stop) {
        return;
    }
    
    window.requestAnimationFrame(drawLoop);

    //limit framerate to 60fps
    now = Date.now();
    elapsed = now-then;

    if(elapsed > fpsInterval) {
        then=now - (elapsed %fpsInterval);

        //draw things
        c.save();
        c.globalAlpha = alphaValue;
        c.fillStyle = backgroundColor;
        c.fillRect(0, 0, canvas.width, canvas.height);
        c.fill();
        c.restore();
        
        drawAll(snowflake, boids);
    }
}




var flockRangeSlider = document.getElementById("flockRangeSlider");
var flockRangeOutput = document.getElementById("flockRangeOut");
flockRangeOutput.innerHTML = "Flocking range: screen Height * " + flockRangeSlider.value/100;
flockRangeSlider.oninput = function() {
    flockRangeOutput.innerHTML = "Flocking range: screen Height * " + flockRangeSlider.value/100;
    boids.forEach(boid => {
        boid.flockRadius = canvas.height * (this.value)/100;
    });
}

var boidMoveSpeedSlider = document.getElementById("boidMoveSpeedSlider");
var moveSpeedOut = document.getElementById("boidMoveSpeedOut");
moveSpeedOut.innerHTML = "Boid speed: " + boidMoveSpeedSlider.value;
boidMoveSpeedSlider.oninput = function() {
    moveSpeedOut.innerHTML = "Boid speed: " + boidMoveSpeedSlider.value;
    boids.forEach(boid => {
        //boid.moveSpeed = (Math.random() * (2 - 1) + 1)*(this.value/10) * (canvas.height/1250);
        boid.moveSpeed = (this.value/10) * (canvas.height/1250);
    });
}

var boidSizeSlider = document.getElementById("boidSizeSlider");
var boidSizeOut = document.getElementById("boidSizeOut");
boidSizeOut.innerHTML = "Boid Size: " + boidSizeSlider.value;
boidSizeSlider.oninput = function() {
    boidSizeOut.innerHTML = "Boid size: " + this.value;
    boids.forEach(boid => {
        boid.sideLength = this.value/8;
    });
}

var boidSeparationSlider = document.getElementById("separationSlider");
var boidSeparationOut = document.getElementById("separationOut");
boidSeparationOut.innerHTML = "Separation weight: " + boidSeparationSlider.value;
boidSeparationSlider.oninput = function () {
    boidSeparationOut.innerHTML = "Separation weight: " + boidSeparationSlider.value;
    var separationFactor;
    if(betterCohesionSim.checked == true) {
        separationFactor = 10;
    } else {
        separationFactor = 2;
    }
    boids.forEach(boid => {
        boid.separation = boidSeparationSlider.value/separationFactor;
    });
}

var boidCohesionSlider = document.getElementById("cohesionSlider");
var boidCohesionOut = document.getElementById("cohesionOut");
boidCohesionOut.innerHTML = "Cohesion weight: " + boidCohesionSlider.value;
boidCohesionSlider.oninput = function () {
    boidCohesionOut.innerHTML = "Cohesion weight: " + boidCohesionSlider.value;
    var cohesionFactor;
    if(betterCohesionSim.checked == true) {
        cohesionFactor = 1/250000;
    } else {
        cohesionFactor = 1/2000;
    }
    boids.forEach(boid => {
        boid.cohesion = Math.PI * (cohesionFactor * boidCohesionSlider.value);
    });
}

var boidAlignmentSlider = document.getElementById("alignmentSlider");
var boidAlignmentOut = document.getElementById("alignmentOut");
boidAlignmentOut.innerHTML = "Alignment weight: " + boidAlignmentSlider.value;
boidAlignmentSlider.oninput = function () {
    boidAlignmentOut.innerHTML = "Alignment weight: " + boidAlignmentSlider.value;
    var alignmentFactor;
    if(betterAlignmentSim.checked == true) {
        alignmentFactor = 1/20000;
    } else {
        alignmentFactor = 1/2000;
    }
    boids.forEach(boid => {
        boid.alignment = Math.PI * (alignmentFactor*boidAlignmentSlider.value);
    });
}

var alphaSlider = document.getElementById("alphaSlider");
var alphaOut = document.getElementById("alphaOut");
alphaOut.innerHTML = "Trails length: " + alphaSlider.value;
alphaValue = (10-alphaSlider.value)/10;;
alphaSlider.oninput = function () {
    alphaOut.innerHTML = "Trails length: " + alphaSlider.value;
    alphaValue = (10-alphaSlider.value)/10;
}

mouseInputBox = document.getElementById("mouseInputBox");
var mouseInputOut = document.getElementById("mouseInputOut");
mouseInputOut.innerHTML = "Avoid mouse?";

avoidWallsBox = document.getElementById("avoidWallsBox");
var avoidWallsOut = document.getElementById("avoidWallsOut");
avoidWallsOut.innerHTML = "Avoid walls? (not recommended)";

colorsFlockBox = document.getElementById("flockingColorsBox");
betterAlignmentSim = document.getElementById("betterAlignmentSim");
betterCohesionSim = document.getElementById("betterCohesionSim");
betterSeparationSim = document.getElementById("betterSeparationSim");

betterSeparationSim.oninput = function () {
    if(betterSeparationSim.checked == true) {
        boidSeparationSlider.max = 25;
    } else {
        boidSeparationSlider.max = 100;
    }
}



function setNumBoids(desiredNum) {
    var currentBoids = boids.length;
    if(currentBoids > desiredNum) {
        for(let i = 0; i < currentBoids - desiredNum; i++) {
            boids.pop();
        }
        boids.forEach(boid => {
            boid.update();
        });
    }
    else {
        for(let i = boids.length; i < desiredNum; i++) {
            var x = Math.random()*canvas.width;
            var y = Math.random()*canvas.height;
            var angle = Math.random()*(2*Math.PI);
            var size = boidSizeSlider.value;
            var avoidance = boidSeparationSlider.value/2;
            var cohesion = boidCohesionSlider.value/250000;
            var color = Math.floor(Math.random() * 5);
            var speed = (boidMoveSpeedSlider.value/10) * (canvas.height/1250)
            var flockRadius = canvas.height * (flockRangeSlider.value)/100
            var alignment = Math.PI * (boidAlignmentSlider.value/20000);
            boids.push(new Boid(angle, new Vert(x, y), size, avoidance, cohesion, alignment, color, speed, flockRadius));
        }
    }   
}

var numBoids = document.getElementById("numBoids");
numBoids.onchange = function () {
    setNumBoids(parseInt(numBoids.value));
}

setNumBoids(parseInt(numBoids.value));  //TODO make relevant to sliders

var i = 0;
startDrawLoop();