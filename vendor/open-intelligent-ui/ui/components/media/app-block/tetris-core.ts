export type TetrisMatrix=number[][];

/** Pure collision rule shared by the reviewed game and unit tests. */
export function tetrisHit(board:number[][],matrix:TetrisMatrix,x:number,y:number):boolean {
  const height=board.length,width=board[0]?.length??0;
  return matrix.some((row,dy)=>row.some((filled,dx)=>filled!==0&&(x+dx<0||x+dx>=width||y+dy>=height||(y+dy>=0&&board[y+dy][x+dx]!==-1))));
}

export function tetrisRotate(matrix:TetrisMatrix):TetrisMatrix {
  return matrix[0].map((_,column)=>matrix.map(row=>row[column]).reverse());
}

/** Mutates the caller's board in place so the game retains its original state flow. */
export function tetrisClearLines(board:number[][]):number {
  let count=0;
  for(let y=board.length-1;y>=0;y--){
    if(board[y].every(cell=>cell!==-1)){
      board.splice(y,1);board.unshift(Array(board[0].length).fill(-1));count++;y++;
    }
  }
  return count;
}
